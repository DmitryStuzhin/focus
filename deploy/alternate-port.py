#!/usr/bin/env python3
"""Move only Focus HTTPS to 8443; leave Docker and VPN listeners untouched."""
import os
import pathlib
import re
import shutil
import subprocess
import time

PORT = 8443

def transform_nginx(text):
    if 'tokenapp.ru' not in text or 'letsencrypt/live/tokenapp.ru/' not in text:
        raise ValueError('Expected the existing certified Focus nginx host')
    changed, count = re.subn(r'(\blisten\s+(?:\[::\]:|(?:[0-9.]+):)?)(?:443|8443)(?=\s|;)', lambda m: m[1]+str(PORT), text)
    if not count:
        raise ValueError('No Focus HTTPS listener found')
    # Certbot redirects the HTTP host to HTTPS without a port by default.
    changed = re.sub(r'https://\$host(?::(?:443|8443))?\$request_uri', 'https://$host:8443$request_uri', changed)
    changed = re.sub(r'https://tokenapp\.ru(?::(?:443|8443))?(?=/|\$|;)', 'https://tokenapp.ru:8443', changed)
    return changed

def transform_env(text):
    lines = [line for line in text.splitlines() if not line.startswith('PUBLIC_ORIGIN=')]
    lines.append('PUBLIC_ORIGIN=https://tokenapp.ru:8443')
    return '\n'.join(lines)+'\n'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    config = pathlib.Path('/etc/nginx/conf.d/focus.conf')
    env = pathlib.Path('/etc/focus/app.env')
    old_config, old_env = config.read_text(), env.read_text()
    new_config, new_env = transform_nginx(old_config), transform_env(old_env)
    backup = pathlib.Path('/etc/focus/port-backups') / str(time.time_ns())
    backup.mkdir(mode=0o700, parents=True)
    os.chmod(backup.parent, 0o700)
    shutil.copy2(config, backup/'focus.conf')
    shutil.copy2(env, backup/'app.env')
    os.chmod(backup/'app.env', 0o600)
    try:
        config.write_text(new_config)
        env.write_text(new_env)
        os.chmod(env, 0o600)
        run('nginx','-t')
        run('systemctl','restart','focus')
        run('systemctl','reload','nginx')
        # This only adds a web port if UFW is already enabled.
        if shutil.which('ufw'):
            status = subprocess.run(['ufw','status'], capture_output=True, text=True, env={**os.environ,'LC_ALL':'C'})
            if 'Status: active' in status.stdout:
                run('ufw','allow','8443/tcp')
        for attempt in range(10):
            probe = subprocess.run(['curl','--fail','--silent','--show-error','--noproxy','*','--max-time','3','--resolve','tokenapp.ru:8443:127.0.0.1','https://tokenapp.ru:8443/healthz'],capture_output=True,text=True)
            if probe.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Focus HTTPS readiness failed: '+probe.stderr.strip())
    except Exception:
        shutil.copy2(backup/'focus.conf', config)
        shutil.copy2(backup/'app.env', env)
        subprocess.run(['nginx','-t'],check=False)
        subprocess.run(['systemctl','reload','nginx'],check=False)
        subprocess.run(['systemctl','restart','focus'],check=False)
        raise
    run('systemctl','enable','--now','focus','focus-update.timer','certbot.timer')
    pathlib.Path('/etc/focus/installed').touch(mode=0o600)
    print('\nFocus: https://tokenapp.ru:8443')
    print('Local HTTPS check: '+probe.stdout)
    print('Autodeploy enabled. VPN/Docker configuration unchanged.')

if __name__ == '__main__':
    main()
