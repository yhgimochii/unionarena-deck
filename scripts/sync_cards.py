import json, re, time
from pathlib import Path
from urllib.parse import urlencode
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'cards.json'
RUGIA = 'https://rugiacreation.com/ua/search'
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; UA-Deck-Analyzer/1.0)'}

# Keep the existing hand-verified cards as a seed. The sync expands the database.
try:
    cards = {x['id']: x for x in json.loads(OUT.read_text(encoding='utf-8'))}
except Exception:
    cards = {}

def clean(text):
    return re.sub(r'\s+', ' ', text or '').strip()

def discover_versions(html):
    soup = BeautifulSoup(html, 'html.parser')
    versions = set()
    # Prefer the select that contains known Rugia work/version codes such as CSM.
    for sel in soup.find_all('select'):
        vals=[]
        for opt in sel.find_all('option'):
            v=(opt.get('value') or '').strip()
            t=clean(opt.get_text(' ', strip=True))
            if re.fullmatch(r'[A-Za-z0-9]{2,10}', v) and v.upper() not in {'ALL','RED','BLUE','YELLOW','GREEN','PURPLE'}:
                vals.append(v)
        if any(v.upper() == 'CSM' for v in vals):
            versions.update(vals)
            break
    return sorted(versions)

def text_lines(node):
    # Rugia uses images for symbols. Keep the readable Traditional Chinese around them.
    return [clean(x.get_text(' ', strip=True)) for x in node.find_all(['div','p','li']) if clean(x.get_text(' ', strip=True))]

def parse_page(html, version):
    soup = BeautifulSoup(html, 'html.parser')
    found=[]
    # Card-number anchors are the stable identifier on Rugia pages.
    anchors = soup.find_all('a', href=True)
    for a in anchors:
        href=a.get('href','')
        m=re.search(r'Card=([^#&]+)', href)
        if not m: continue
        code=m.group(1).replace('_','/')
        if '/' not in code: continue
        # Expected format SET/VERSION-NUMBER, e.g. UA53BT/CSM-1-047.
        if not re.match(r'^[A-Z0-9]+/[A-Za-z0-9]+-\d+-[A-Za-z0-9]+$', code): continue
        # Find a nearby container and extract readable text.
        parent=a
        for _ in range(5):
            if parent.parent is None: break
            parent=parent.parent
        block='\n'.join(text_lines(parent))
        # Name is usually the next text after the card code/rarity.
        lines=[x for x in block.split('\n') if x]
        rarity=''
        mm=re.search(r'\((C|U|R|SR|UR|SP|AP|PR|PcC|PcR|PcSR)(?:\W|$)', block)
        if mm: rarity=mm.group(1)
        name=''
        pos=next((i for i,x in enumerate(lines) if code in x),None)
        if pos is not None:
            for candidate in lines[pos+1:pos+5]:
                if candidate and not re.match(r'^(C|U|R|SR|UR|SP|AP|PR|PcC|PcR|PcSR)$', candidate):
                    name=candidate; break
        if not name: name=code
        # Collapse duplicate parallel rows; the first occurrence is enough for base data.
        effect=''
        if pos is not None:
            effect_lines=[]
            for x in lines[pos+1:]:
                if x == name: continue
                if x.startswith('入手方法：'): break
                if x.startswith('UA') and '/' in x: break
                effect_lines.append(x)
            effect='\n'.join(effect_lines[:20])
        found.append({'id':code,'rarity':rarity,'name':name,'effect':effect,'url':f'https://rugiacreation.com/ua/search?Name=HK&Card={code.replace("/","_")}#{code.replace("/","_")}','source':'Rugia sync'})
    return found

def main():
    r=requests.get(RUGIA,params={'Name':'HK'},headers=HEADERS,timeout=30)
    r.raise_for_status()
    versions=discover_versions(r.text)
    if not versions:
        raise RuntimeError('Could not discover Rugia work/version list.')
    print(f'Discovered {len(versions)} version codes.')
    for i,v in enumerate(versions,1):
        try:
            rr=requests.get(RUGIA,params={'Name':'HK','Version':v},headers=HEADERS,timeout=30)
            rr.raise_for_status()
            rows=parse_page(rr.text,v)
            print(f'[{i}/{len(versions)}] {v}: {len(rows)} rows')
            for row in rows:
                old=cards.get(row['id'],{})
                # Never replace richer hand-entered fields with a weaker scrape.
                merged={**row,**{k:val for k,val in old.items() if val not in ('',None,[],{})}}
                cards[row['id']]=merged
            time.sleep(0.25)
        except Exception as e:
            print(f'WARN {v}: {e}')
    OUT.write_text(json.dumps(sorted(cards.values(),key=lambda x:x['id']),ensure_ascii=False,indent=2)+"\n",encoding='utf-8')
    print(f'Wrote {len(cards)} cards to {OUT}')

if __name__=='__main__': main()
