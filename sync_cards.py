import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "cards.json"
RUGIA = "https://rugiacreation.com/ua/search"
OFFICIAL = "https://www.unionarena-tcg.com/en/cardlist/detail_iframe.php?card_no="
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; UA-Deck-Analyzer/6.0)"}

# Rugia uses separate links for the set and card number, e.g.
# <set link>UA43BT</set link> / <card link>SMD-1-042</card link> (C)
# Normalising all visible text before matching makes this parser independent of the
# exact HTML/link nesting used by each IP.
HEADER_RE = re.compile(
    r"(?P<set>[A-Z0-9]+)\s*/\s*"
    r"(?P<num>(?:[A-Z0-9]+-\d+-\d{3}(?:-[A-Z0-9]+)?|[A-Z0-9]+-\d+-AP\d{2}))"
    r"(?:\s*\((?P<rarity>[^)]+)\))?",
    re.I,
)
FULL_ID_RE = re.compile(
    r"^[A-Z0-9]+/[A-Z0-9]+-\d+-\d{3}(?:-[A-Z0-9]+)?$", re.I
)
AP_ID_RE = re.compile(r"^[A-Z0-9]+/[A-Z0-9]+-\d+-AP\d{2}$", re.I)
RARITY_RE = re.compile(r"^(?:SR|UR|SP|PcSR|PcR|PcC|R|U|C|AP|PR)(?:★+)?$", re.I)
SET_RE = re.compile(r"^(?:UA\d+(?:BT|ST|DC)|EX\d+BT|PC\d+BT|UAPR|PR\d+BT)$", re.I)

# Current known Rugia version/IP codes. Discovery from the site is still the primary
# mechanism, so newly added IPs can be picked up without changing this list.
FALLBACK_VERSIONS = {
    "AOT", "BLC", "NIK", "IMSC", "IMSH", "KRM", "ARK", "WBK", "MCR", "FMA", "KNN",
    "REZ", "RNK", "MON", "SMD", "EVA", "TLR", "KGB", "TGH", "KNG", "SCL", "IYS",
    "EIS", "CSM", "MUS", "CGD", "GGL", "MHA", "JJK", "HUN", "DS", "GNT", "YYS",
    "DGM", "BLU", "STN", "SHY", "SYN", "DRS", "OPM", "BLA", "KMR", "GMR", "HIK",
    "BTL", "GAM", "UMI", "SLA", "GGS", "KAI", "SBR", "100K",
}

# These are only safety-net set codes. Most are discovered automatically from Rugia.
FALLBACK_SETS = {
    "UA01BT", "UA02BT", "UA03BT", "UA04BT", "UA05BT", "UA06BT", "UA07BT", "UA08BT",
    "UA09BT", "UA10BT", "UA11BT", "UA12BT", "UA13BT", "UA14BT", "UA15BT", "UA16BT",
    "UA17BT", "UA18BT", "UA19BT", "UA20BT", "UA21BT", "UA22BT", "UA23BT", "UA24BT",
    "UA25BT", "UA26BT", "UA27BT", "UA28BT", "UA29BT", "UA30BT", "UA31BT", "UA32BT",
    "UA33BT", "UA34BT", "UA35BT", "UA36BT", "UA37BT", "UA38BT", "UA39BT", "UA40BT",
    "UA41BT", "UA42BT", "UA43BT", "UA44BT", "UA45BT", "UA46BT", "UA47BT", "UA48BT",
    "UA49BT", "UA50BT", "UA51BT", "UA52BT", "UA53BT", "UAPR",
}


# Explicit verification queries for the three known cross-IP test cards.
# These are queried directly even if Rugia's Version filter or discovery changes.
CRITICAL_SET_QUERIES = {
    "UA43BT": "UA43BT/SMD-1-042",
    "EX15BT": "EX15BT/BLC-4-004",
    "UA53BT": "UA53BT/CSM-1-061",
}


def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def normalize_version(v):
    return clean(v).upper().strip()


def load_existing():
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        return {x["id"]: x for x in data if isinstance(x, dict) and x.get("id")}
    except Exception:
        return {}


def get(session, url, params=None, timeout=45, retries=3):
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = session.get(url, params=params, headers=HEADERS, timeout=timeout)
            if r.ok:
                return r
            last = RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:
            last = e
        if attempt < retries:
            time.sleep(1.5 * attempt)
    raise last or RuntimeError("request failed")


def discover_versions(soup):
    versions = set(FALLBACK_VERSIONS)

    for opt in soup.find_all("option"):
        value = normalize_version(opt.get("value", ""))
        label = clean(opt.get_text(" ", strip=True))
        if value and re.fullmatch(r"[A-Z][A-Z0-9]{1,12}", value):
            if value not in {"ALL", "0", "NONE", "SELECT", "HK", "JP", "EN", "TC", "SC"}:
                versions.add(value)
        for m in re.finditer(r"[〖\[]([A-Z0-9]{2,12})[〗\]]", label):
            versions.add(m.group(1).upper())

    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        for m in re.finditer(r"[?&]Version=([^&#\"']+)", href, re.I):
            v = normalize_version(m.group(1))
            if re.fullmatch(r"[A-Z][A-Z0-9]{1,12}", v):
                versions.add(v)

    return sorted(versions)


def image_replacement_text(img):
    """Recover text represented by Rugia image-only keyword icons.

    Rugia renders several UA keywords as <img> elements. Depending on the page
    version, the useful label may be in alt/title/aria-label or encoded in the
    image filename. Return a Traditional-Chinese text token when recognizable.
    """
    attrs = [
        img.get("alt", ""),
        img.get("title", ""),
        img.get("aria-label", ""),
        img.get("data-alt", ""),
        img.get("src", ""),
    ]
    raw = " ".join(clean(x) for x in attrs if x).strip()
    if not raw:
        return "Image"

    # Japanese/English labels commonly used by Bandai/Rugia.
    m = re.search(r"(?:インパクト|impact)[^0-9０-９]*(\d+|[０-９])", raw, re.I)
    if m:
        n = m.group(1)
        n = ''.join(str(ord(ch)-0xFF10) if '０' <= ch <= '９' else ch for ch in n)
        circled = {"1":"➊","2":"➋","3":"➌","4":"➍","5":"➎","6":"➏","7":"➐","8":"➑","9":"➒"}
        return "衝擊" + circled.get(n, n)

    m = re.search(r"(?:ダメージ|damage)[^0-9０-９]*(\d+|[０-９])", raw, re.I)
    if m:
        n = m.group(1)
        n = ''.join(str(ord(ch)-0xFF10) if '０' <= ch <= '９' else ch for ch in n)
        circled = {"1":"➊","2":"➋","3":"➌","4":"➍","5":"➎","6":"➏","7":"➐","8":"➑","9":"➒"}
        return "傷害" + circled.get(n, n)

    # Traditional/Chinese labels if Rugia supplies them directly.
    m = re.search(r"(?:衝擊|傷害)\s*[（(]\s*([0-9０-９]+)\s*[）)]", raw)
    if m:
        label = "衝擊" if "衝擊" in raw else "傷害"
        n = m.group(1)
        n = ''.join(str(ord(ch)-0xFF10) if '０' <= ch <= '９' else ch for ch in n)
        circled = {"1":"➊","2":"➋","3":"➌","4":"➍","5":"➎","6":"➏","7":"➐","8":"➑","9":"➒"}
        return label + circled.get(n, n)

    return "Image"


def normalised_text(soup):
    # Preserve image-only keyword icons before converting the DOM to plain text.
    # This is essential because soup.get_text() otherwise drops <img> elements.
    clone = BeautifulSoup(str(soup), "html.parser")
    for img in clone.find_all("img"):
        img.replace_with(" " + image_replacement_text(img) + " ")

    # Keep separators as spaces. Rugia's set/card links can be separated by newlines,
    # tabs, or literal whitespace depending on the IP page.
    return clean(clone.get_text(" ", strip=True))


def extract_headers(soup):
    text = normalised_text(soup)
    found = []
    seen = set()
    for m in HEADER_RE.finditer(text):
        cid = f"{m.group('set').upper()}/{m.group('num').upper()}"
        rarity = clean(m.group("rarity") or "")
        if not (FULL_ID_RE.fullmatch(cid) or AP_ID_RE.fullmatch(cid)):
            continue
        # Ignore false positives where the parenthetical text is clearly not rarity.
        if rarity and not RARITY_RE.fullmatch(rarity):
            rarity = ""
        key = (m.start(), cid, rarity)
        if key not in seen:
            seen.add(key)
            found.append((m.start(), m.end(), cid, rarity))
    return text, found


def name_and_effect(text, headers, index):
    start = headers[index][1]
    end = headers[index + 1][0] if index + 1 < len(headers) else len(text)
    block = clean(text[start:end])

    # Rugia's search text places the card name immediately before the effect.
    # Some cards start their effect with phrases that are not part of the name,
    # e.g. "波奇塔 此卡不能在前線登場...".  The old parser only knew a small
    # set of markers, so those descriptions were accidentally appended to names.
    # Keep multi-word names intact and cut only when a known effect-start phrase
    # occurs after whitespace.
    block = re.sub(r"^(?:Image\s*)+", "", block, flags=re.I)
    block = re.sub(r"^(?:[A-Z0-9]+/[A-Z0-9-]+\s*)+", "", block)

    effect_markers = [
        "攻擊結束時", "主起動", "登場時", "攻擊時", "退場時", "阻擋時",
        "自己回合中", "對手回合中", "本回合中", "回合中",
        "此角色", "此卡", "此場域", "此事件", "此效果",
        "選擇", "從以下", "從自己", "從對手", "抽取", "抽１", "抽２", "抽３",
        "將此", "將自己", "將對手", "可以", "不能", "不可", "若", "如果",
        "自己場上", "自己前線", "自己能源線", "自己手牌", "自己牌庫", "自己場外",
        "對手場上", "對手前線", "對手能源線", "對手手牌", "對手牌庫", "對手場外",
        "放置", "加入手牌", "公開", "查看", "移動", "休息", "激活",
        "使用", "支付", "獲得", "失去", "增加", "減少", "根據",
        "在自己", "在對手", "每次", "每當", "本回合", "此回合",
        "能源需求", "AP消耗", "BP", "COLOR", "FINAL", "SPECIAL",
    ]

    cut = len(block)
    for marker in effect_markers:
        # Require whitespace before the marker so words inside a card name are
        # not split accidentally.
        for m in re.finditer(r"\s+" + re.escape(marker), block):
            cut = min(cut, m.start())
            break

    name = clean(block[:cut]).strip(" ：:")
    if not name:
        # Last-resort fallback: keep the whole block rather than inventing a name.
        name = clean(block)

    effect = clean(block[cut:].strip()) if cut < len(block) else ""
    return name, effect

def parse_rugia(html):
    soup = BeautifulSoup(html, "html.parser")
    text, headers = extract_headers(soup)
    rows = {}
    for i, (start, end, cid, rarity) in enumerate(headers):
        name, effect = name_and_effect(text, headers, i)
        # Find1 with the card number is accepted by Rugia and is stable for direct links.
        card_num = cid.split("/", 1)[1]
        row = {
            "id": cid,
            "name": name,
            "rarity": rarity,
            "effect": effect,
            "url": f"{RUGIA}?Name=HK&Find1={quote(card_num)}",
            "source": "Rugia sync",
        }
        if cid not in rows:
            row["variants"] = [rarity] if rarity else []
            rows[cid] = row
        else:
            # Same gameplay card can have multiple print rarities such as R/R★ or
            # SR/SR★★★. Keep one gameplay record while preserving every observed print.
            variants = rows[cid].setdefault("variants", [])
            if rarity and rarity not in variants:
                variants.append(rarity)
            # Prefer the non-star/base rarity for the main display label.
            if not rows[cid].get("rarity") or ("★" in rows[cid]["rarity"] and "★" not in rarity):
                rows[cid]["rarity"] = rarity
    return list(rows.values())


def discover_sets_from_page(soup):
    sets = set()
    text = normalised_text(soup)
    for m in HEADER_RE.finditer(text):
        sc = m.group("set").upper()
        if SET_RE.fullmatch(sc):
            sets.add(sc)
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        label = clean(a.get_text(" ", strip=True)).upper()
        if SET_RE.fullmatch(label) and ("Find1=" in href or "Card=" in href):
            sets.add(label)
        for m in re.finditer(r"(?:[?&]Find1=|[?&]Card=)(UA\d+(?:BT|ST|DC)|EX\d+BT|PC\d+BT|UAPR|PR\d+BT)", href, re.I):
            sets.add(m.group(1).upper())
    return sets


def parse_official(cid, html):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    imgs = [clean(i.get("alt", "")) for i in soup.find_all("img") if i.get("alt")]
    out = {}

    # Official pages often render the energy colour as an image alt rather than plain text.
    m = re.search(r"Required\s*Energy\s*\n(?:Image:?\s*)?([A-Za-z]+)?-?\s*(\d+)", text, re.I)
    if m:
        out["energyColor"] = (m.group(1) or "").capitalize()
        out["energy"] = int(m.group(2))
    else:
        for alt in imgs:
            mm = re.fullmatch(r"(Red|Blue|Yellow|Green|Purple)-?(\d+)?", alt, re.I)
            if mm and mm.group(2):
                out["energyColor"] = mm.group(1).capitalize()
                out["energy"] = int(mm.group(2))
                break

    m = re.search(r"Consumed\s*AP\s*\n\s*(\d+)", text, re.I)
    if m:
        out["ap"] = int(m.group(1))

    m = re.search(r"Card\s*Type\s*\n\s*(Character|Site|Event|Action Point)", text, re.I)
    if m:
        out["type"] = {"Character": "角色", "Site": "場域", "Event": "事件", "Action Point": "AP"}.get(m.group(1), m.group(1))

    m = re.search(r"\nBP\s*\n\s*(\d+)\s*\n", text, re.I)
    if m:
        out["bp"] = int(m.group(1))

    m = re.search(r"Trait\s*\n\s*([^\n]+)", text, re.I)
    if m:
        t = clean(m.group(1))
        if t and t not in {"-", "None"}:
            out["traits"] = [t]

    m = re.search(r"Trigger\s*\n\s*([^\n]+)", text, re.I)
    if m:
        trig = clean(m.group(1))
        if trig and trig not in {"-", "None"}:
            out["trigger"] = trig
    return out


def enrich(cid, row, session):
    try:
        r = get(session, OFFICIAL + quote(cid, safe=""), timeout=25, retries=2)
        meta = parse_official(cid, r.text)
        for k, v in meta.items():
            if v not in (None, "", []):
                row[k] = v
    except Exception as e:
        print(f"WARN official {cid}: {e}")
    return row


def main():
    session = requests.Session()
    session.headers.update(HEADERS)
    existing = load_existing()

    base = get(session, RUGIA, params={"Name": "HK"})
    base_soup = BeautifulSoup(base.text, "html.parser")
    versions = discover_versions(base_soup)
    print(f"Discovered {len(versions)} Rugia version/IP codes")
    print("Versions:", ", ".join(versions))

    discovered = {}
    discovered_sets = set(FALLBACK_SETS)

    # Query every known/discovered IP. A non-zero result is enough to discover its set code(s).
    for idx, version in enumerate(versions, 1):
        try:
            r = get(session, RUGIA, params={"Name": "HK", "Version": version})
            soup = BeautifulSoup(r.text, "html.parser")
            rows = parse_rugia(r.text)
            sets = discover_sets_from_page(soup)
            discovered_sets.update(sets)
            print(f"[{idx}/{len(versions)}] {version}: {len(rows)} cards; sets={len(sets)}")
            for row in rows:
                discovered[row["id"]] = row
        except Exception as e:
            print(f"WARN {version}: {e}")

    # Also parse the generic page; it can expose promos/new entries before the version filter does.
    base_rows = parse_rugia(base.text)
    discovered_sets.update(discover_sets_from_page(base_soup))
    print(f"Generic Rugia page: {len(base_rows)} cards")
    for row in base_rows:
        discovered[row["id"]] = row

    # Second pass: query by set code. This is the important fallback for Rugia IPs where
    # Version=... is not honoured by the server-side search page.
    print(f"Set-code fallback candidates: {len(discovered_sets)}")
    for idx, set_code in enumerate(sorted(discovered_sets), 1):
        try:
            r = get(session, RUGIA, params={"Name": "HK", "Find1": set_code})
            rows = parse_rugia(r.text)
            if rows:
                print(f"[set {idx}/{len(discovered_sets)}] {set_code}: {len(rows)} cards")
            for row in rows:
                discovered[row["id"]] = row
        except Exception as e:
            print(f"WARN set {set_code}: {e}")

    # Critical direct set pass. This avoids relying on Version discovery/server-side
    # filtering for the known SMD/BLEACH/CSM verification cards.
    print("Direct critical-set verification pass:")
    for set_code, expected_id in CRITICAL_SET_QUERIES.items():
        try:
            r = get(session, RUGIA, params={"Name": "HK", "Find1": set_code})
            rows = parse_rugia(r.text)
            print(f"  {set_code}: parsed {len(rows)} cards; expected {expected_id} -> "
                  f"{'FOUND' if any(x.get('id') == expected_id for x in rows) else 'MISSING'}")
            for row in rows:
                discovered[row["id"]] = row
        except Exception as e:
            print(f"  ERROR {set_code}: {e}")

    print(f"Total Rugia cards discovered: {len(discovered)}")

    # Fail immediately, before expensive official metadata requests, so the Action log
    # tells us exactly which source/card failed instead of ending later at verification.
    critical_missing = [cid for cid in CRITICAL_SET_QUERIES.values() if cid not in discovered]
    if critical_missing:
        print("CRITICAL CARDS MISSING FROM RUGIA PARSE:")
        for cid in critical_missing:
            print(f"  MISSING: {cid}")
        raise SystemExit("SYNC FAILED: Rugia parser did not capture required cards: " + ", ".join(critical_missing))

    if not discovered:
        raise SystemExit("SYNC FAILED: Rugia returned zero cards. Refusing to overwrite cards.json.")

    # Merge newly discovered data into the existing DB. Existing official metadata is preserved
    # if Rugia doesn't expose a particular field on a search page.
    cards = dict(existing)
    for cid, row in discovered.items():
        old = cards.get(cid, {})
        merged = dict(old)
        merged.update({k: v for k, v in row.items() if v not in ("", None, [])})
        cards[cid] = merged

    # Fetch official structured fields only when necessary.
    todo = []
    for cid in discovered:
        d = cards[cid]
        if any(k not in d for k in ("energy", "ap", "type")) or (d.get("type") == "角色" and "bp" not in d):
            todo.append(cid)
    print(f"Official metadata to fetch: {len(todo)} cards")
    for i, cid in enumerate(todo, 1):
        cards[cid] = enrich(cid, cards[cid], session)
        if i % 25 == 0:
            print(f"Enriched {i}/{len(todo)}")
        time.sleep(0.05)

    # Hard verification before writing. These cards intentionally cover different IPs.
    checks = ["UA43BT/SMD-1-042", "EX15BT/BLC-4-004", "UA53BT/CSM-1-061"]
    missing = [cid for cid in checks if cid not in cards]
    if missing:
        raise SystemExit("SYNC FAILED: required cards missing: " + ", ".join(missing))

    output = sorted(cards.values(), key=lambda x: x["id"])
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(output)} cards to {OUT}")
    print("Verification:")
    for cid in checks:
        d = cards[cid]
        print(f"  {cid} FOUND | {d.get('name','')} | {d.get('rarity','')}")


if __name__ == "__main__":
    main()
