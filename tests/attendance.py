"""Run the complete desk flow against disposable PHP processes sharing one store."""
import concurrent.futures
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import uuid
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, Request

root = Path(__file__).resolve().parents[1]

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def client():
    return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

def request(opener, base, action, body=None, status=200):
    req = Request(base + '/api.php?action=' + action,
                  data=None if body is None else json.dumps(body).encode(),
                  headers={'Content-Type':'application/json','X-TechData-Request':'desk'})
    try:
        response = opener.open(req)
    except HTTPError as error:
        response = error
    with response:
        content = json.load(response)
        assert response.status == status, (action, response.status, content)
        return content

with tempfile.TemporaryDirectory() as tmp:
    runtime = Path(tmp)
    storage = runtime / 'private'
    env = dict(os.environ, TECHDATA_STORAGE=str(storage))
    ports = [port(), port()]
    bases = ['http://127.0.0.1:' + str(p) for p in ports]
    servers = [subprocess.Popen(['php','-S','127.0.0.1:'+str(p),'-t',str(root)],
                                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for p in ports]
    try:
        guests = client()
        for base in bases:
            for _ in range(40):
                try:
                    assert request(guests,base,'session') == {'active':False,'ready':False}
                    break
                except OSError:
                    time.sleep(.05)
            else:
                raise RuntimeError('Local PHP test server unavailable')
        base = bases[0]
        staff = client()
        other = client()
        password = 'QA-staff-fixture-only!'
        code = (storage/'setup-code.txt').read_text().strip()
        request(guests,base,'guests',status=401)
        request(staff,base,'activate',{'code':'invalid','password':password},403)
        request(staff,base,'activate',{'code':code,'password':password})
        assert not (storage/'setup-code.txt').exists()
        request(other,bases[1],'login',{'password':password})
        guest = dict(name='Sample Guest',email='check@example.test',company='Test, Inc.',country='Indonesia',title='Producer')
        entry = request(staff,base,'add',{'rows':[guest]})
        guest_id = entry['id']
        assert entry['added'] == 1
        request(staff,base,'add',{'rows':[guest]},409)
        second = dict(guest,email='second@example.test')
        invalid = dict(guest,email='invalid')
        request(staff,base,'import',{'rows':[second,invalid]},422)
        assert len(request(staff,base,'guests')['guests']) == 1
        imported = request(staff,base,'import',{'rows':[second,guest,dict(guest,email='CHECK@example.test')]})
        assert (imported['added'], imported['skipped']) == (1,2)
        assert imported['id'] != guest_id
        assert set(request(guests,base,'pass',{'id':guest_id})) == {'name','company','id'}
        request(guests,base,'scan',{'id':guest_id},401)
        request(staff,base,'scan',{'id':'TD-UNKNOWN'},404)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            jobs = [pool.submit(request,op,url,'scan',{'id':guest_id}) for op,url in zip([staff,other],bases)]
            scans = [job.result() for job in jobs]
        assert sorted(scan['duplicate'] for scan in scans) == [False,True]
        assert scans[0]['guest']['present_at'] == scans[1]['guest']['present_at']
        assert sum(bool(g['present_at']) for g in request(other,bases[1],'guests')['guests']) == 1
        inspire = dict(guest, event='Inspire', first='Sample', last='Guest', category='Partner - Delegate')
        missing = dict(inspire, first='No', last='Email', email='')
        request(staff,base,'manifest',{'rows':[inspire, missing]})
        again = request(staff,base,'manifest',{'rows':[inspire, missing]})
        assert again['added'] == 0 and again['skipped'] == 2

        # Restore representative historical memberships directly in the disposable store.
        storefile = storage/'desk.json'
        state = json.loads(storefile.read_text())
        both = state['guests'][guest_id]
        historical = dict(both['events']['Inspire'], name='Archive Guest', present_at='2026-01-01T10:00:00Z')
        both['events']['RLS'] = historical
        retired_id = 'TD-'+'9'*24
        state['guests'][retired_id] = dict(both, id=retired_id, email='archive@example.test', events={'RLS':historical})
        storefile.write_text(json.dumps(state))

        live = request(staff,base,'guests')
        assert len(live['guests'])==3 and live['walkins']==[]
        assert all(set(g['events'])=={'Inspire'} for g in live['guests'])
        assert request(guests,base,'pass',{'id':guest_id})['id']==guest_id
        for action, status in [('pass',404),('scan',409)]:
            request(staff,base,action,{'id':retired_id},status)
        request(staff,base,'scan',{'id':guest_id,'event':'RLS'},422)
        request(staff,base,'manifest',{'rows':[dict(inspire,event='RLS')]},422)
        assert request(staff,base,'scan',{'id':guest_id,'event':'Inspire'})['duplicate']

        entry = str(uuid.uuid4())
        walk = {'entry':entry,'guest':dict(guest, name='Walk In',email='archive@example.test')}
        request(guests,base,'walk-in',walk,401)
        request(staff,base,'walk-in',dict(walk,guest=guest),409)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            jobs = [pool.submit(request,op,url,'walk-in',dict(walk,entry=k)) for op,url,k in zip([staff,other],bases,[entry,str(uuid.uuid4())])]
            arrivals = [job.result() for job in jobs]
        assert sorted(r['duplicate'] for r in arrivals)==[False,True]
        assert arrivals[0]['present_at']==arrivals[1]['present_at']
        live = request(staff,base,'guests')
        assert len(live['guests'])==3 and len(live['walkins'])==1
        visitor = live['walkins'][0]
        assert 'id' not in visitor and visitor['present_at']
        request(guests,base,'pass',{'id':visitor['entry']},404)
        request(staff,base,'scan',{'id':visitor['entry']},404)
        request(guests,base,'backup',{},401)
        request(guests,base,'reset-attendance',{'event':'Inspire','confirmation':'RESET Inspire'},401)
        backup=request(staff,base,'backup',{})
        assert json.loads((storage/'backups'/backup['file']).read_text())['walkins'][visitor['entry']]['present_at']
        request(staff,base,'reset-attendance',{'event':'RLS','confirmation':'RESET RLS'},422)
        request(staff,base,'reset-attendance',{'event':'Walk-In','confirmation':'RESET Inspire'},422)
        reset=request(staff,base,'reset-attendance',{'event':'Inspire','confirmation':'RESET Inspire'})
        assert reset['cleared']==1
        before = json.loads((storage/'backups'/reset['file']).read_text())
        assert before['guests'][guest_id]['events']['Inspire']['present_at']
        live = request(staff,base,'guests')
        assert not next(g for g in live['guests'] if g['id']==guest_id)['present_at']
        assert live['walkins'][0]['present_at']==visitor['present_at']
        assert json.loads(storefile.read_text())['guests'][guest_id]['events']['RLS']==historical
        reset=request(staff,base,'reset-attendance',{'event':'Walk-In','confirmation':'RESET Walk-In'})
        assert reset['cleared']==1
        assert not request(staff,base,'walk-in',{'entry':visitor['entry']})['duplicate']
        assert request(staff,base,'walk-in',walk)['duplicate']
        replacement = 'New-fixture-password!'
        change = {'password':password,'newPassword':replacement}
        request(guests,base,'change-password',change,401)
        request(staff,base,'change-password',dict(change,password='wrong'),403)
        request(staff,base,'change-password',dict(change,newPassword='tiny'),422)
        request(staff,base,'change-password',change)
        fresh = client()
        request(fresh,base,'login',{'password':password},403)
        request(fresh,base,'login',{'password':replacement})
        assert len(request(fresh,base,'guests')['guests']) == 3
        original = request(fresh,base,'guests')
        remove = {'id':guest_id, 'confirmation':'Sample Guest'}
        request(guests,base,'remove-guest',remove,401)
        request(fresh,base,'remove-guest',dict(remove,confirmation='Other Guest'),422)
        assert request(fresh,base,'guests') == original
        for target in (guest_id, imported['id']):
            prior = json.loads(storefile.read_text())
            result = request(fresh,base,'remove-guest',dict(remove,id=target))
            assert json.loads((storage/'backups'/result['file']).read_text()) == prior
            expected = [g for g in original['guests'] if g['id'] != target]
            assert request(fresh,base,'guests') == dict(original,guests=expected)
            original['guests'] = expected
            request(guests,base,'pass',{'id':target},404)
            request(fresh,base,'scan',{'id':target},409 if target==guest_id else 404)
            request(fresh,base,'remove-guest',dict(remove,id=target),404)
        assert json.loads(storefile.read_text())['guests'][guest_id]['events'] == {'RLS':historical}
        request(staff,base,'logout',{})
        request(staff,base,'guests',status=401)
        print('Activation, auth, imports, pass privacy and concurrent check-in passed.')
    finally:
        for server in servers:
            server.terminate()
            server.wait()
