import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEdge } from './edge-loader.mjs';

const secrets = { MODEL_CONFIG_KEYRING: JSON.stringify({
  active_key_id: 'current', legacy_key_id: 'old', keys: { old: 'b'.repeat(64), current: 'c'.repeat(64) },
}) };
globalThis.Deno = { env: { get: name => secrets[name] }, serve() {} };
const registry = await loadEdge('supabase/functions/_shared/model-registry.ts', 'keyring-interop');
const context = 'platform-connection:isolated-user:tiktok:原账户', plain = 'isolated-双向-key';
const modern = await registry.encryptKey(context, plain);
const oldKey = await crypto.subtle.importKey('raw', Buffer.from('b'.repeat(64), 'hex'), 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(context) }, oldKey, Buffer.from(plain));
const legacy = `${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`;
const directory = mkdtempSync(join(process.cwd(), '.volcengine-build/key-interop-'));
try {
  writeFileSync(join(directory, 'fixture.json'), JSON.stringify({ context, plain, modern, legacy, ring: secrets.MODEL_CONFIG_KEYRING }), { mode: 0o600 });
  const archive = spawnSync('tar', ['--format=ustar', '--exclude=__pycache__', '-cf', '-', '-C', directory, 'fixture.json',
    '-C', process.cwd(), 'scripts/backup_restore.py'], { maxBuffer: 1024 * 1024 });
  assert.equal(archive.status, 0, archive.stderr?.toString());
  const python = `
import base64,importlib.util,json,os
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
spec=importlib.util.spec_from_file_location("backup","/tmp/interop/scripts/backup_restore.py")
backup=importlib.util.module_from_spec(spec); spec.loader.exec_module(backup)
data=json.loads(Path("/tmp/interop/fixture.json").read_text())
file=Path("/tmp/interop/ring"); file.write_text(data["ring"]); file.chmod(0o600)
ring=backup.credential_keyring({"model_keyring":str(file)})
assert backup.decrypt_credential(data["context"],data["modern"],ring)=="current"
assert backup.decrypt_credential(data["context"],data["legacy"],ring)=="old"
for cipher in (data["modern"].replace("v2.current.","v2.old."),data["modern"]+".extra"):
    try: backup.decrypt_credential(data["context"],cipher,ring)
    except backup.BackupError: pass
    else: raise AssertionError("tampering accepted")
nonce=os.urandom(12)
aad=json.dumps(["v2","current",data["context"]],ensure_ascii=False,separators=(",",":")).encode()
payload=AESGCM(ring["keys"]["current"]).encrypt(nonce,data["plain"].encode(),aad)
print(json.dumps({"cipher":".".join(("v2","current",base64.b64encode(nonce).decode(),base64.b64encode(payload).decode()))}))
`;
  const result = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--read-only',
    '--tmpfs', '/tmp:rw,size=16m', '--entrypoint', 'sh', 'shoproai-backup:local', '-c',
    'mkdir /tmp/interop && tar -xf - -C /tmp/interop && python -c "$1"', 'sh', python],
  { input: archive.stdout, maxBuffer: 1024 * 1024, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(await registry.decryptKey(context, JSON.parse(result.stdout.toString()).cipher), plain);
  console.log('PASS: actual Edge ↔ Python AES-GCM, v2/legacy, Unicode AAD and tampering');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
