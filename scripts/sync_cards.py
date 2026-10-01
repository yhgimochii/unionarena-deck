import json
import re
import time
from pathlib import Path
from urllib.parse import quote, urljoin

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
    # BeautifulSoup represents multi-valued HTML attributes such as class
    # as AttributeValueList/list objects. Convert those to plain text before
    # passing them to regex/string operations.
    if s is None:
        return ""
    if isinstance(s, (list, tuple, set)):
        s = " ".join(str(x) for x in s)
    else:
        s = str(s)
    return re.sub(r"\s+", " ", s).strip()


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


IMAGE_TOKEN_RE = re.compile(r"\[\[UAIMG:(https?://[^]\s<>\"']+)\]\]", re.I)
CSS_URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", re.I)

KEYWORD_FALLBACK_BASE = "https://rugiacreation.com/ua/images/"


def _normalise_asset_url(raw):
    if not raw:
        return ""
    raw = str(raw).strip().strip('"\'')
    if not raw or raw.startswith("data:") or raw.startswith("javascript:"):
        return ""
    if raw.startswith("//"):
        raw = "https:" + raw
    url = urljoin("https://rugiacreation.com/ua/", raw)
    if re.match(r"^https?://", url, re.I):
        return url
    return ""


def _keyword_fallback(raw):
    """Recover known UA keyword assets when Rugia exposes only semantic metadata."""
    raw = clean(raw or "")
    patterns = [
        (r"(?:keyword[_-]?)?impact[_-]?(\d+)", "keyword_impact{n}.png"),
        (r"(?:keyword[_-]?)?damage[_-]?(\d+)", "keyword_damage{n}.png"),
        (r"(?:インパクト|衝擊|衝撃|impact)[^0-9０-９]*([1-9０-９])", "keyword_impact{n}.png"),
        (r"(?:ダメージ|傷害|damage)[^0-9０-９]*([1-9０-９])", "keyword_damage{n}.png"),
    ]
    for pattern, filename in patterns:
        m = re.search(pattern, raw, re.I)
        if m:
            n = m.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789"))
            return urljoin(KEYWORD_FALLBACK_BASE, filename.format(n=n))
    return ""


def _image_url(img):
    """Return the actual image URL from normal, lazy, srcset, style, or data attrs."""
    candidates = [
        img.get("src"), img.get("data-src"), img.get("data-original"),
        img.get("data-lazy-src"), img.get("data-url"), img.get("data-image"),
        img.get("data-original-src"), img.get("data-bg"), img.get("data-background"),
    ]
    srcset = img.get("srcset") or img.get("data-srcset")
    if srcset:
        parts = [p.strip().split()[0] for p in srcset.split(",") if p.strip()]
        candidates.extend(reversed(parts))
    style = img.get("style", "")
    candidates.extend(CSS_URL_RE.findall(style))

    # Prefer explicit image URLs over semantic fallbacks.
    for raw in candidates:
        url = _normalise_asset_url(raw)
        if url:
            return url

    raw_meta = " ".join(clean(img.get(k, "")) for k in (
        "alt", "title", "aria-label", "data-alt", "data-name", "data-keyword", "class", "id"
    ) if img.get(k))
    return _keyword_fallback(raw_meta)


def _img_token(img):
    url = _image_url(img)
    if url:
        return f"[[UAIMG:{url}]]"

    alt = clean(img.get("alt", ""))
    if alt and alt.lower() not in {"image", "img", "icon"}:
        return alt
    return ""


def _tag_background_token(tag):
    """Extract CSS background/data image assets from non-img keyword elements."""
    attrs = [
        tag.get("style", ""), tag.get("data-bg", ""), tag.get("data-background", ""),
        tag.get("data-image", ""), tag.get("data-src", ""),
    ]
    raw = " ".join(str(x) for x in attrs if x)
    urls = CSS_URL_RE.findall(raw)
    for raw_url in urls:
        url = _normalise_asset_url(raw_url)
        if url:
            return f"[[UAIMG:{url}]]"
    meta = " ".join(clean(tag.get(k, "")) for k in (
        "alt", "title", "aria-label", "data-alt", "data-name", "data-keyword", "class", "id"
    ) if tag.get(k))
    fallback = _keyword_fallback(meta)
    return f"[[UAIMG:{fallback}]]" if fallback else ""


def _preserve_rugia_markup(soup):
    """Preserve Rugia text, line breaks, <img> assets, and CSS background assets."""
    clone = BeautifulSoup(str(soup), "html.parser")

    for br in clone.find_all("br"):
        br.replace_with("\n")

    for img in clone.find_all("img"):
        img.replace_with(" " + _img_token(img) + " ")

    # Some keyword icons are spans/divs with CSS background-image instead of <img>.
    # Only inject a token when an actual image URL or known keyword metadata exists.
    for tag in clone.find_all(["span", "div", "i", "a"]):
        token = _tag_background_token(tag)
        if not token:
            continue
        # Avoid duplicating an asset that is already represented by a nested <img>.
        if tag.find("img"):
            continue
        # If this is an icon-only element, replace it. If it contains text, prepend
        # the asset token so we preserve both the icon and the text.
        visible = clean(tag.get_text(" ", strip=True))
        if not visible or visible.lower() in {"image", "img", "icon"}:
            tag.replace_with(" " + token + " ")
        else:
            tag.insert_before(" " + token + " ")

    for tag in clone.find_all(["p", "div", "li"]):
        if tag.name == "li":
            tag.insert_before("\n")
        tag.append("\n")

    return clone


def _clean_preserve_breaks(text):
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalised_text(soup):
    clone = _preserve_rugia_markup(soup)
    return _clean_preserve_breaks(clone.get_text("", strip=False))


def _token_to_html(text):
    import html as _html
    out = []
    pos = 0
    for m in IMAGE_TOKEN_RE.finditer(str(text or "")):
        out.append(_html.escape(str(text or "")[pos:m.start()]).replace("\n", "<br>"))
        url = _html.escape(m.group(1), quote=True)
        out.append(
            f'<img class="ua-keyword-icon" src="{url}" alt="" loading="lazy" '
            f'referrerpolicy="no-referrer">'
        )
        pos = m.end()
    out.append(_html.escape(str(text or "")[pos:]).replace("\n", "<br>"))
    return "".join(out)

def _strip_image_tokens_for_plain(text):
    return IMAGE_TOKEN_RE.sub("", str(text or ""))

def _remove_known_rugia_trigger_suffix(text):
    """Remove the duplicated Raid sentence that Rugia includes after effects.

    The separate `trigger` field is populated from the official card data, so the
    Chinese Raid sentence should not also remain at the end of the main effect.
    This is deliberately narrow to avoid deleting legitimate effect text.
    """
    s = _clean_preserve_breaks(text)
    raid = "將此卡加入手牌，或在滿足能源需求的情況下進行突襲。"
    s = re.sub(r"\s*" + re.escape(raid) + r"\s*$", "", s)
    # Rugia sometimes inserts the same trigger on a separate line with an
    # image token/label before it. Remove only the exact known Raid body.
    s = re.sub(r"(?:\n|\s)*突襲(?:\n|\s)*" + re.escape(raid) + r"\s*$", "", s)
    return s.strip()



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
    block = _clean_preserve_breaks(text[start:end])

    # Rugia can put image tokens before/inside the title. Do not let a generic
    # image placeholder become part of the visible card name.
    block = re.sub(r"^(?:\[\[UAIMG:[^\]]+\]\]\s*)+", "", block, flags=re.I)
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
        for m in re.finditer(r"(?:^|\s)" + re.escape(marker), block):
            cut = min(cut, m.start() if block[m.start()] != "\n" else m.start() + 1)
            break

    name = _clean_preserve_breaks(block[:cut]).strip(" ：:\n")
    if not name:
        name = _clean_preserve_breaks(block)

    effect = _clean_preserve_breaks(block[cut:].strip()) if cut < len(block) else ""
    return name, effect

def parse_rugia(html):
    soup = BeautifulSoup(html, "html.parser")
    text, headers = extract_headers(soup)
    rows = {}
    for i, (start, end, cid, rarity) in enumerate(headers):
        name, effect = name_and_effect(text, headers, i)
        # Find1 with the card number is accepted by Rugia and is stable for direct links.
        card_num = cid.split("/", 1)[1]
        effect = _remove_known_rugia_trigger_suffix(effect)
        row = {
            "id": cid,
            "name": name,
            "rarity": rarity,
            "effect": _strip_image_tokens_for_plain(effect).strip(),
            "effectHtml": _token_to_html(effect),
            "nameHtml": _token_to_html(name),
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
    # Helpful verification: if Rugia supplied image assets, the saved row should
    # contain the original image URL token rather than the literal word "Image".
    image_rows = sum(1 for r in rows.values() if "[[UAIMG:" in r.get("effectHtml", "") or "[[UAIMG:" in r.get("nameHtml", ""))
    if image_rows:
        print(f"  preserved Rugia image markup in {image_rows} cards")
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
