#!/usr/bin/env python3
"""Build the standalone APK with an Android SDK and JDK; no Gradle or npm needed."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
SDK = Path(os.environ.get('ANDROID_SDK_ROOT') or os.environ.get('ANDROID_HOME') or Path.home() / 'Android/Sdk')
TOOLS = Path(os.environ.get('ANDROID_BUILD_TOOLS', str(SDK / 'build-tools/35.0.0')))
PLATFORM = Path(os.environ.get('ANDROID_PLATFORM_JAR', str(SDK / 'platforms/android-34/android.jar')))
BUILD = ROOT / 'build'

def tool(name):
    executable = TOOLS / (name + ('.bat' if os.name == 'nt' and name in ('d8','apksigner') else '.exe' if os.name == 'nt' else ''))
    if not executable.exists():
        raise SystemExit(f'Missing {executable}. Install Android SDK Build-Tools 35.0.0 or set ANDROID_BUILD_TOOLS.')
    return str(executable)

def run(args):
    subprocess.run([str(a) for a in args], check=True, cwd=ROOT)

if not PLATFORM.exists():
    raise SystemExit('Install Android SDK Platform 34 or set ANDROID_PLATFORM_JAR to android.jar.')
for name in ('classes','dex','assets'):
    path = BUILD / name
    if path.exists(): shutil.rmtree(path)
    path.mkdir(parents=True)
shutil.copytree(ROOT / 'www', BUILD / 'assets/www')
shutil.copy2(ROOT / 'android/seed.json', BUILD / 'assets/seed.json')
sources = [str(p) for p in (ROOT / 'android/src').rglob('*.java')]
ecj = os.environ.get('CHECKIN_COMPILER_JAR')
if ecj:
    run(['java','-jar',ecj,'-8','-nowarn','-classpath',PLATFORM,'-d',BUILD/'classes',*sources])
else:
    run(['javac','-source','8','-target','8','-classpath',PLATFORM,'-d',BUILD/'classes',*sources])
with zipfile.ZipFile(BUILD/'classes.jar','w',zipfile.ZIP_DEFLATED) as archive:
    for path in (BUILD/'classes').rglob('*.class'): archive.write(path,path.relative_to(BUILD/'classes'))
run([tool('d8'),'--min-api','26','--lib',PLATFORM,'--output',BUILD/'dex',BUILD/'classes.jar'])
run([tool('aapt'),'package','-f','-M',ROOT/'android/AndroidManifest.xml','-S',ROOT/'android/res','-A',BUILD/'assets','-I',PLATFORM,'-F',BUILD/'unsigned.apk'])
with zipfile.ZipFile(BUILD/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as archive:
    for path in (BUILD/'dex').glob('*.dex'): archive.write(path,path.name)
run([tool('zipalign'),'-f','4',BUILD/'unsigned.apk',BUILD/'aligned.apk'])
signing = ROOT/'android/signing'
signing.mkdir(exist_ok=True)
key = signing/'children-check-in.keystore'
config = signing/'key.json'
if not key.exists():
    if config.exists(): raise SystemExit('Signing key missing. Restore the original keystore to preserve update compatibility.')
    config.write_text(json.dumps({'alias':'childrencheckin','password':secrets.token_urlsafe(32)}))
    config.chmod(0o600)
    settings = json.loads(config.read_text())
    os.environ['CHECKIN_KEY_PASSWORD'] = settings['password']
    run(['keytool','-genkeypair','-keystore',key,'-alias',settings['alias'],'-keyalg','RSA','-keysize','2048','-validity','10000','-storepass:env','CHECKIN_KEY_PASSWORD','-keypass:env','CHECKIN_KEY_PASSWORD','-dname','CN=Children Check In, O=Local App'])
    key.chmod(0o600)
settings = json.loads(config.read_text())
os.environ['CHECKIN_KEY_PASSWORD'] = settings['password']
output = ROOT/'Children-Check-In.apk'
run([tool('apksigner'),'sign','--ks',key,'--ks-key-alias',settings['alias'],'--ks-pass','env:CHECKIN_KEY_PASSWORD','--key-pass','env:CHECKIN_KEY_PASSWORD','--out',output,BUILD/'aligned.apk'])
run([tool('apksigner'),'verify','--verbose',output])
print(f'Built {output.name}: {output.stat().st_size:,} bytes')
