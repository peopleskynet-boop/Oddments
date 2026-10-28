# Russian interface strings that have no English yet (src/lib/i18n-en.json).
#   python tools/i18n_missing.py            — list them, with the file each comes from
# Every Russian literal is split into what the DOM shows as separate pieces — text between tags and the values of
# title / aria-label / placeholder / alt — and inside each piece ${…} becomes {0}, {1}… (the dictionary's form).
# Add the missing ones to i18n-en.json by hand (JSON, UTF-8, LF line ends).
import re, glob, os, json
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
SKIP_FILES = {'src/lib/aitags.js', 'src/lib/people.js', 'src/lib/iconai-examples.js', 'src/lib/screens.js', 'src/lib/pii.js', 'src/lib/telegram.js'}  # word lists that match text, not interface
files = [f.replace(os.sep, '/') for f in glob.glob('src/**/*.js', recursive=True)]
files = [f for f in files if '/web/' not in f and f not in SKIP_FILES] + ['index.html']
CYR = re.compile('[А-Яа-яЁё]')
lit = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`")


def placeholders(t):
    # ${ … } with nesting → {n}
    out, i, n = '', 0, 0
    while i < len(t):
        if t.startswith('${', i):
            depth, j = 1, i + 2
            while j < len(t) and depth:
                if t.startswith('${', j):
                    depth += 1; j += 2; continue
                if t[j] == '{': depth += 1
                elif t[j] == '}': depth -= 1
                j += 1
            out += '{%d}' % n; n += 1; i = j
        else:
            out += t[i]; i += 1
    return out


keys = {}


def add(k, f):
    k = re.sub(r'\s+', ' ', k).strip()
    k = k.replace('\\n', ' ').replace("\\'", "'").replace('\\"', '"').strip()
    if not CYR.search(k) or len(re.sub(r'\{\d+\}', '', k).strip()) < 2:
        return
    keys.setdefault(k, f)


def literals(code, depth=0):
    out = []
    for m in lit.finditer(code):
        t = next(g for g in m.groups() if g is not None)
        out.append(t)
        if m.group(3) is not None and depth < 4:  # a template: the literals inside its ${…} too
            for e in re.findall(r'\$\{((?:[^{}]|\{[^{}]*\})*)\}', t):
                out += literals(e, depth + 1)
    return out


ATTR = r'(?:title|aria-label|placeholder|alt|data-tip)="([^"]*)"'
for f in files:
    s = open(f, encoding='utf-8').read()
    s = re.sub(r'^\s*//.*$', '', s, flags=re.M)
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    s = re.sub(r'<!--[\s\S]*?-->', '', s)
    for t in ([s] if f.endswith('.html') else literals(s)):
        if not CYR.search(t):
            continue
        t = t if f.endswith('.html') else placeholders(t)
        for m in re.finditer(ATTR, t):
            add(m.group(1), f)
        text = re.sub(ATTR.replace('([^"]*)', '[^"]*'), '', t)
        if '<' in text and '>' in text:
            for seg in re.split(r'<[^>]*>', text):
                add(seg, f)
        elif not f.endswith('.html'):
            add(text, f)

en = json.load(open('src/lib/i18n-en.json', encoding='utf-8'))
missing = [(k, f) for k, f in keys.items() if k not in en]
for k, f in sorted(missing, key=lambda x: x[1]):
    print(f'{f}\t{k}')
print(f'— без перевода: {len(missing)} из {len(keys)}; больше всего: {Counter(f for _, f in missing).most_common(5)}')
