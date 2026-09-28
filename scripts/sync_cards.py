import json, re, time
from pathlib import Path
from urllib.parse import urljoin, quote
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "cards.json"
RUGIA = "https://rugiacreation.com/ua/search"
OFFICIAL = "https://www.unionarena-tcg.com/en/cardlist/detail_iframe.php?card_no="
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; UA-Deck-Analyzer/2.0)"}

try:
    cards = {x["id"]: x for x in json.loads(OUT.read_text(encoding="utf-8"))}
except Exception:
    cards = {}

CARD_RE = re.compile(r"^(?:[A-Za-z0-9]+-\d+-\d{3}|[A-Za-z0-9]+-\d+-AP\d{2})$")
SET_RE = re.compile(r"^(?:UA\d+(?:BT|ST|DC)|EX\d+BT|PC\d+BT|UAPR|PR\d+BT)$", re.I)
RARITY_RE = re.compile(r"\((?:SR|UR|SP|PcSR|PcR|PcC|R|U|C|AP|PR)(?:★+)?\)")


def clean(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s


def code_from_anchor(a):
    text = clean(a.get_text(" ", strip=True))
    if CARD_RE.fullmatch(text):
        return text
    href = a.get("href", "")
    m = re.search(r"[?&]Find1=([^&#]+)", href)
    if m:
        v = m.group(1).replace("%2D", "-")
        if CARD_RE.fullmatch(v):
            return v
    return None


def find_set_for(a):
    # On Rugia the set and card-number are adjacent links, e.g. UA43BT / SMD-1-042.
    for prev in a.find_all_previous("a", limit=8):
        t = clean(prev.get_text(" ", strip=True))
        if SET_RE.fullmatch(t):
            return t.upper()
    return ""


def find_name(a):
    for nxt in a.find_all_next("a", limit=8):
        t = clean(nxt.get_text(" ", strip=True))
        if not t or t.lower() == "image":
            continue
        if SET_RE.fullmatch(t) or CARD_RE.fullmatch(t):
            continue
        if len(t) <= 80:
            return t
    return ""


def block_for(a, code):
    # Pick the smallest ancestor containing this card code but no other card header.
    node = a
    best = a.parent
    for _ in range(8):
        node = node.parent
        if node is None:
            break
        txt = node.get_text("\n", strip=True)
        codes = set(CARD_RE.findall(txt))
        if code in codes and len(codes) == 1:
            best = node
            break
    return best


def parse_rugia(html):
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for a in soup.find_all("a", href=True):
        code = code_from_anchor(a)
        if not code:
            continue
        set_code = find_set_for(a)
        if not set_code:
            continue
        block = block_for(a, code)
        text = block.get_text("\n", strip=True)
        lines = [clean(x) for x in text.splitlines() if clean(x)]
        name = find_name(a)
        if not name:
            name = code
        rarity = ""
        m = RARITY_RE.search(text)
        if m:
            rarity = m.group(0).strip("()")
        # Remove header-like lines and duplicate image labels.
        effect_lines = []
        started = False
        for line in lines:
            if line == name:
                started = True
                continue
            if not started:
                continue
            if line.lower() == "image":
                continue
            if CARD_RE.fullmatch(line) or SET_RE.fullmatch(line):
                break
            effect_lines.append(line)
        effect = "\n".join(effect_lines[:40]).strip()
        cid = f"{set_code}/{code}"
        found[cid] = {
            "id": cid,
            "name": name,
            "rarity": rarity,
            "effect": effect,
            "url": f"{RUGIA}?Name=HK&Find1={quote(code)}",
            "source": "Rugia sync",
        }
    return list(found.values())


def parse_official(cid, html):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    imgs = [clean(i.get("alt", "")) for i in soup.find_all("img") if i.get("alt")]
    out = {}
    m = re.search(r"Required\s*Energy\s*\n(?:Image:\s*)?([A-Za-z]+)?\s*(\d+)", text, re.I)
    if not m:
        for alt in imgs:
            mm = re.fullmatch(r"(Red|Blue|Yellow|Green|Purple)(\d+)", alt, re.I)
            if mm:
                out["energyColor"] = mm.group(1).capitalize()
                out["energy"] = int(mm.group(2))
                break
    else:
        out["energyColor"] = m.group(1).capitalize() if m.group(1) else ""
        out["energy"] = int(m.group(2))
    m = re.search(r"Consumed\s*AP\s*\n\s*(\d+)", text, re.I)
    if m: out["ap"] = int(m.group(1))
    m = re.search(r"Card\s*Type\s*\n\s*(Character|Site|Event|Action Point)", text, re.I)
    if m:
        out["type"] = {"Character":"角色","Site":"場域","Event":"事件","Action Point":"AP"}.get(m.group(1),m.group(1))
    m = re.search(r"\nBP\s*\n\s*(\d+)\s*\n", text, re.I)
    if m: out["bp"] = int(m.group(1))
    # Trait is normally plain text after Trait.
    m = re.search(r"Trait\s*\n\s*([^\n]+)", text, re.I)
    if m:
        t = clean(m.group(1))
        if t and t not in {"-", "None"}: out["traits"] = [t]
    return out


def enrich(cid, row, session):
    try:
        url = OFFICIAL + quote(cid, safe="")
        r = session.get(url, headers=HEADERS, timeout=20)
        if r.ok:
            meta = parse_official(cid, r.text)
            row.update({k:v for k,v in meta.items() if v not in (None,"",[])})
    except Exception as e:
        print(f"WARN official {cid}: {e}")
    return row


def main():
    s = requests.Session()
    r = s.get(RUGIA, params={"Name":"HK"}, headers=HEADERS, timeout=45)
    r.raise_for_status()
    rows = parse_rugia(r.text)
    print(f"Rugia all-card page: {len(rows)} unique cards discovered")
    # Merge Rugia data first.
    for row in rows:
        old = cards.get(row["id"], {})
        merged = {**old, **{k:v for k,v in row.items() if v not in ("",None,[])}}
        cards[row["id"]] = merged
    # Enrich newly discovered cards. Limit per run only if Rugia returned an unusually huge set.
    for i,row in enumerate(rows,1):
        cid=row["id"]
        # Always refresh structured fields; preserve manually entered values if official parsing misses them.
        old=cards[cid]
        enriched=enrich(cid, old, s)
        cards[cid]=enriched
        if i % 25 == 0: print(f"Enriched {i}/{len(rows)}")
        time.sleep(0.05)
    OUT.write_text(json.dumps(sorted(cards.values(), key=lambda x:x["id"]), ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(f"Wrote {len(cards)} cards to {OUT}")

if __name__ == "__main__":
    main()
