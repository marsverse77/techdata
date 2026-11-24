<?php
declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
umask(0077);

final class DeskError extends RuntimeException {}
function reject(int $status, string $message): never { throw new DeskError($message, $status); }
function writePrivate(string $path, string $content): void {
    $tmp = tempnam(dirname($path), '.write-');
    if ($tmp === false) throw new RuntimeException('Temporary file unavailable');
    try {
        if (file_put_contents($tmp, $content) !== strlen($content) || !rename($tmp, $path)) {
            throw new RuntimeException('Storage write failed');
        }
    } finally { if (is_file($tmp)) unlink($tmp); }
}
require_once __DIR__.'/events.php';
function publicPass(array $g): array {
    return array_intersect_key($g, array_flip(['name','company','id']));
}
function validGuest(mixed $row, int $number, bool $manifest=false): array {
    if (!is_array($row)) reject(422, "Invalid guest on row $number.");
    $g = [];
    $fields=['name'=>380, 'email'=>254, 'country'=>120, 'company'=>200, 'title'=>180];
    if ($manifest) $fields += ['first'=>180,'last'=>180,'category'=>180];
    foreach ($fields as $key=>$max) {
        $v = $row[$key] ?? '';
        if (!is_string($v) || strlen($v) > $max * 4 || preg_match('/[\x00-\x1F\x7F]/', $v)) {
            reject(422, "Check the $key field on row $number.");
        }
        $g[$key] = trim($v);
    }
    if ($manifest && ($g['first'] !== '' || $g['last'] !== '')) $g['name']=trim($g['first'].' '.$g['last']);
    if ($g['name'] === '' || ((!$manifest || $g['email'] !== '') && !filter_var($g['email'], FILTER_VALIDATE_EMAIL))) {
        reject(422, "Row $number needs a full name and valid email address.");
    }
    return $g;
}

function dispatch(string $action, array $input, array &$state, string $dir, bool &$changed): array {
    $now = time();
    $active = isset($_SESSION['until']) && $_SESSION['until'] > $now;
    $ready = isset($state['password']);
    if ($action === 'session') return ['active'=>$active, 'ready'=>$ready];
    $rotating = $action === 'change-password';
    if ($rotating && !$active) reject(401, 'Sign in to change the staff password.');
    if ($action === 'login' || $action === 'activate' || $rotating) {
        $ip = hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'local'));
        $attempt = $state['attempts'][$ip] ?? [0, $now];
        if ($attempt[1] < $now - 600) $attempt = [0, $now];
        if ($attempt[0] >= 12) reject(429, 'Too many attempts. Try again in ten minutes.');
        $pass = $input['password'] ?? '';
        if (!is_string($pass) || strlen($pass) > 72) reject(422, 'Use a password of up to 72 bytes.');
        if ($action === 'activate') {
            if ($ready) reject(409, 'The desk is already activated. Sign in to continue.');
            if (strlen($pass) < 12) reject(422, 'Choose a password with at least 12 characters.');
            $code = $input['code'] ?? '';
            $valid = is_string($code) && hash_equals($state['setupHash'], hash('sha256', trim($code)));
        } else {
            $valid = $ready && password_verify($pass, $state['password']);
        }
        if (!$valid) {
            $state['attempts'] = array_filter($state['attempts'], static fn($a) => $a[1] >= $now-600);
            $state['attempts'][$ip] = [$attempt[0]+1,$attempt[1]];
            $changed = true;
            reject(403, $action === 'activate' ? 'The setup code was not accepted.' : 'The password was not accepted.');
        }
        if ($rotating) {
            $next = $input['newPassword'] ?? null;
            if (!is_string($next) || strlen($next) < 12 || strlen($next) > 72 || str_contains($next, "\0")) {
                reject(422, 'Choose a password between 12 and 72 bytes.');
            }
            $state['password'] = password_hash($next, PASSWORD_DEFAULT);
        } elseif ($action === 'activate') {
            $state['password'] = password_hash($pass, PASSWORD_DEFAULT);
            unset($state['setupHash']);
        }
        unset($state['attempts'][$ip]);
        $changed = true;
        session_regenerate_id(true);
        $_SESSION['until'] = $now + 12 * 3600;
        return ['active'=>true];
    }
    if ($action === 'pass') {
        $id = $input['id'] ?? '';
        if (!is_string($id) || !isset($state['guests'][$id])) reject(404,'This guest pass was not found.');
        if (!isset(memberships($state['guests'][$id])['Inspire'])) reject(404,'This pass is not registered for Inspire.');
        return publicPass($state['guests'][$id]);
    }
    if (!$active) reject(401,'Sign in to open the registration desk.');
    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        return ['active'=>false];
    }
    if ($action === 'guests') {
        $output=[];
        foreach ($state['guests'] as $g) {
            $profile = memberships($g)['Inspire'] ?? null;
            if ($profile !== null) $output[] = $profile + ['id'=>$g['id'], 'email'=>$g['email'], 'events'=>['Inspire'=>$profile]];
        }
        return ['guests'=>$output, 'walkins'=>array_values($state['walkins'] ?? [])];
    }
    if ($action === 'walk-in') return checkInWalkIn($input,$state,$changed);
    if ($action === 'manifest') return importEvents($input['rows'] ?? [],$state,$changed);
    if ($action === 'backup') return ['file'=>snapshotDesk($dir,$state,'manual')];
    if ($action === 'remove-guest') {
        $id = $input['id'] ?? '';
        if (!is_string($id) || !isset($state['guests'][$id])) reject(404,'This registration was not found.');
        $events = memberships($state['guests'][$id]);
        if (!isset($events['Inspire'])) reject(404,'This registration was not found.');
        if (($input['confirmation'] ?? '') !== $events['Inspire']['name']) reject(422,'Enter the full name as shown on the pass.');
        $file = snapshotDesk($dir,$state,'before-remove');
        unset($events['Inspire']);
        if ($events) {
            $state['guests'][$id]['events'] = $events;
            $state['guests'][$id]['present_at'] = null;
        } else {
            unset($state['guests'][$id]);
        }
        $changed = true;
        return ['file'=>$file];
    }
    if ($action === 'reset-attendance') {
        $event=$input['event'] ?? '';
        if (!in_array($event,['Inspire','Walk-In'],true)) reject(422,'Choose an active attendance list.');
        if (($input['confirmation'] ?? '') !== 'RESET '.$event) reject(422,'Type RESET followed by the event name.');
        $file=snapshotDesk($dir,$state,'before-reset-'.$event);
        $count=0;
        if ($event === 'Walk-In') {
            foreach (array_keys($state['walkins'] ?? []) as $key) {
                if ($state['walkins'][$key]['present_at'] === null) continue;
                $state['walkins'][$key]['present_at'] = null;
                $count++;
            }
            $changed=$count>0;
            return ['file'=>$file,'cleared'=>$count];
        }
        foreach ($state['guests'] as &$g) {
            $events=memberships($g);
            if (empty($events[$event]['present_at'])) continue;
            $events[$event]['present_at']=null;
            $g['events']=$events;
            if ($event==='Inspire') $g['present_at']=null;
            $count++;
        }
        unset($g);
        $changed=$count>0;
        return ['file'=>$file,'cleared'=>$count];
    }
    if ($action === 'add' || $action === 'import') {
        $rows = $input['rows'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || count($rows)<1 || count($rows)>5000)
            reject(422, 'Choose between 1 and 5,000 guests per import.');
        $emails = [];
        foreach ($state['guests'] as $guest) {
            if (isset(memberships($guest)['Inspire'])) $emails[strtolower($guest['email'])] = true;
        }
        $pending = [];
        $skipped = 0;
        foreach ($rows as $index=>$row) {
            $g = validGuest($row, $index+($action === 'import' ? 2 : 1));
            $email = strtolower($g['email']);
            if (isset($emails[$email])) {
                if ($action === 'add') reject(409, 'A guest with this email already has a pass.');
                $skipped++;
                continue;
            }
            do { $id = 'TD-'.strtoupper(bin2hex(random_bytes(12))); }
            while (isset($state['guests'][$id]) || isset($pending[$id]));
            $emails[$email] = true;
            $pending[$id] = $g + ['id'=>$id, 'present_at'=>null];
        }
        $state['guests'] += $pending;
        $changed = (bool)$pending;
        return ['added'=>count($pending), 'skipped'=>$skipped, 'id'=>array_key_first($pending)];
    }
    if ($action === 'scan') {
        $id = $input['id'] ?? '';
        if (!is_string($id) || !isset($state['guests'][$id])) reject(404, 'Unknown pass. Check the QR code and try again.');
        $g = &$state['guests'][$id];
        $event=eventName($input['event'] ?? 'Inspire');
        $events=memberships($g);
        if (!isset($events[$event])) reject(409, 'This pass is not registered for '.$event.'.');
        $duplicate=$events[$event]['present_at'] !== null;
        if (!$duplicate) {
            $events[$event]['present_at']=gmdate('Y-m-d\TH:i:s\Z');
            $g['events']=$events;
            if ($event==='Inspire') $g['present_at']=$events[$event]['present_at'];
            $changed=true;
        }
        return ['guest'=>$events[$event] + ['id'=>$id,'email'=>$g['email']], 'duplicate'=>$duplicate];
    }
    reject(404, 'Unknown request.');
}

try {
    $action = $_GET['action'] ?? '';
    $read = in_array($action, ['session','guests'], true);
    if ($_SERVER['REQUEST_METHOD'] !== ($read ? 'GET' : 'POST')) reject(405,'Unsupported method.');
    $input = [];
    if (!$read) {
        if (($_SERVER['HTTP_X_TECHDATA_REQUEST'] ?? '') !== 'desk' ||
            !str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) reject(403,'Invalid request.');
        $raw = file_get_contents('php://input', false, null, 0, 4194305);
        if (strlen($raw) > 4194304) reject(413,'This import is too large. Split it into smaller files.');
        $input = json_decode($raw,true);
        if (!is_array($input)) reject(400,'Invalid request data.');
    }
    session_name('techdata_desk');
    ini_set('session.use_strict_mode','1');
    ini_set('session.gc_maxlifetime','43200');
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_set_cookie_params(['httponly'=>true,'secure'=>$secure,'samesite'=>'Strict','path'=>'/']);
    session_start();
    $root = realpath($_SERVER['DOCUMENT_ROOT']);
    $dir = getenv('TECHDATA_STORAGE') ?: dirname(__DIR__).'/techdata-private';
    if (!is_dir($dir) && !@mkdir($dir,0700,true) && !is_dir($dir)) throw new RuntimeException('Private storage unavailable');
    $dir = realpath($dir);
    if (!$dir || !$root || $dir === $root || str_starts_with($dir.'/', $root.'/')) throw new RuntimeException('Unsafe storage location');
    $file = $dir.'/desk.json';
    $lock = fopen($dir.'/desk.lock','c');
    if (!$lock || !flock($lock,LOCK_EX)) throw new RuntimeException('Cannot lock guest records');
    try {
        if (!is_file($file)) {
            $secret = bin2hex(random_bytes(18));
            writePrivate($dir.'/setup-code.txt', $secret."\n");
            $state = ['setupHash'=>hash('sha256',$secret),'attempts'=>[], 'guests'=>[]];
            writePrivate($file,json_encode($state,JSON_THROW_ON_ERROR));
        } else {
            $state = json_decode(file_get_contents($file),true,512,JSON_THROW_ON_ERROR);
        }
        $changed = false;
        try { $response = dispatch($action,$input,$state,$dir,$changed); }
        finally {
            if ($changed) writePrivate($file,json_encode($state,JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
            if (isset($state['password']) && is_file($dir.'/setup-code.txt')) unlink($dir.'/setup-code.txt');
        }
    } finally { flock($lock,LOCK_UN); fclose($lock); }
    echo json_encode($response,JSON_THROW_ON_ERROR);
} catch (DeskError $e) {
    http_response_code($e->getCode());
    echo json_encode(['error'=>$e->getMessage()]);
} catch (Throwable $e) {
    error_log('TechData storage or runtime error: '.$e->getMessage());
    http_response_code(503);
    echo json_encode(['error'=>'The registration desk is temporarily unavailable. Please try again.']);
}
