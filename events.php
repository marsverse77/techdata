<?php
declare(strict_types=1);

function eventName(mixed $value): string {
    if ($value !== 'Inspire') reject(422, 'QR registration is available for Inspire only.');
    return $value;
}

function memberships(array $g): array {
    if (isset($g['events'])) return $g['events'];
    return ['Inspire'=>[
        'name'=>$g['name'], 'first'=>'', 'last'=>'', 'category'=>'',
        'company'=>$g['company'], 'title'=>$g['title'], 'country'=>$g['country'],
        'present_at'=>$g['present_at'] ?? null
    ]];
}

function importEvents(array $rows, array &$state, bool &$changed): array {
    if (!array_is_list($rows) || !$rows || count($rows)>5000) reject(422, 'Import 1 to 5,000 registrations at a time.');
    $guests = $state['guests'];
    $emails = [];
    $unaddressed = [];
    foreach ($guests as $id=>$g) {
        if (!isset(memberships($g)['Inspire'])) continue;
        if ($g['email'] !== '') $emails[strtolower($g['email'])] = $id;
        else foreach (memberships($g) as $event=>$details)
            $unaddressed[identityKey($event,$details)] = $id;
    }
    $added = $enrolled = $updated = $skipped = 0;
    $firstId = null;
    foreach ($rows as $i=>$row) {
        if (!is_array($row)) reject(422,'Invalid participant row.');
        $event = eventName($row['event'] ?? null);
        $g = validGuest($row, $i+1, true);
        $profile = array_diff_key($g, ['email'=>true]);
        $email = strtolower($g['email']);
        $key = identityKey($event,$profile);
        $id = ($email !== '' ? ($emails[$email] ?? null) : null) ?? ($unaddressed[$key] ?? null);
        if ($id === null) {
            do { $id = 'TD-'.strtoupper(bin2hex(random_bytes(12))); } while (isset($guests[$id]));
            $guests[$id] = $g + ['id'=>$id,'present_at'=>null,'events'=>[]];
            $added++;
        }
        $record = &$guests[$id];
        $events = memberships($record);
        $old = $events[$event] ?? null;
        $profile['present_at'] = $old['present_at'] ?? null;
        if (!$old) $enrolled++;
        elseif ($profile != $old || ($email !== '' && $record['email'] === '')) $updated++;
        else $skipped++;
        $events[$event] = $profile;
        if ($email !== '') {
            $record['email']=$g['email'];
            $emails[$email]=$id;
            unset($unaddressed[$key]);
        } else $unaddressed[$key]=$id;
        $record['events']=$events;
        $primary=$events['Inspire'];
        foreach (['name','company','title','country'] as $field) $record[$field]=$primary[$field];
        $record['present_at']=$events['Inspire']['present_at'] ?? null;
        $firstId ??= $id;
        unset($record);
    }
    $changed = $guests != $state['guests'];
    $state['guests']=$guests;
    return compact('added','enrolled','updated','skipped') + ['id'=>$firstId];
}

function identityKey(string $event, array $p): string {
    return $event."\n".strtolower(trim($p['name']))."\n".strtolower(trim($p['company']));
}

function checkInWalkIn(array $input, array &$state, bool &$changed): array {
    $key = $input['entry'] ?? '';
    if (!is_string($key) || !preg_match('/^[0-9a-f-]{36}$/D', $key)) reject(422, 'Invalid walk-in registration reference.');
    $entries = $state['walkins'] ?? [];
    if (!isset($entries[$key])) {
        $guest = validGuest($input['guest'] ?? null, 1, true);
        if ($guest['email'] !== '') {
            foreach ($state['guests'] as $registered) {
                if (isset(memberships($registered)['Inspire']) && strcasecmp($registered['email'], $guest['email']) === 0)
                    reject(409, 'This email is on the Inspire list. Use the guest’s existing Inspire pass.');
            }
            foreach ($entries as $id=>$existing) {
                if (strcasecmp($existing['email'], $guest['email']) === 0) { $key=$id; break; }
            }
        }
        $entries[$key] ??= $guest + ['entry'=>$key, 'present_at'=>null];
    }
    $duplicate = $entries[$key]['present_at'] !== null;
    if (!$duplicate) {
        $entries[$key]['present_at'] = gmdate('Y-m-d\TH:i:s\Z');
        $state['walkins'] = $entries;
        $changed = true;
    }
    return ['duplicate'=>$duplicate, 'present_at'=>$entries[$key]['present_at']];
}

function snapshotDesk(string $dir, array $state, string $reason): string {
    $target=$dir.'/backups';
    if (!is_dir($target) && !mkdir($target,0700,true) && !is_dir($target)) throw new RuntimeException('Backup folder unavailable');
    $name=gmdate('Ymd-His').'-'.$reason.'-'.bin2hex(random_bytes(4)).'.json';
    writePrivate($target.'/'.$name,json_encode($state,JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    return $name;
}
