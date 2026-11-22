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
        replacement = 'New-fixture-password!'
        change = {'password':password,'newPassword':replacement}
        request(guests,base,'change-password',change,401)
        request(staff,base,'change-password',dict(change,password='wrong'),403)
        request(staff,base,'change-password',dict(change,newPassword='tiny'),422)
        request(staff,base,'change-password',change)
        fresh = client()
        request(fresh,base,'login',{'password':password},403)
        request(fresh,base,'login',{'password':replacement})
        assert len(request(fresh,base,'guests')['guests']) == 2
        request(staff,base,'logout',{})
        request(staff,base,'guests',status=401)
        print('Activation, auth, imports, pass privacy and concurrent check-in passed.')
    finally:
        for server in servers:
            server.terminate()
            server.wait()
