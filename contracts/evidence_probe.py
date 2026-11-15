# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json
import re
from genlayer import *

MAX_EXTRACTED_CHARS = 2500
PROBE_USER_AGENT = "PublicMuseProber/1.0 (https://github.com/public-muse; probe@publicmuse.dev)"


def _extract_deterministic_text(raw_text: str, max_chars: int = MAX_EXTRACTED_CHARS) -> str:
    """Deterministically normalize JSON/wikitext/plain-text payloads into bounded text."""
    text = raw_text
    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            if "parse" in parsed and isinstance(parsed["parse"], dict):
                wikitext = parsed["parse"].get("wikitext")
                if isinstance(wikitext, dict) and "*" in wikitext:
                    title = str(parsed["parse"].get("title", "")).strip()
                    body = str(wikitext["*"])
                    text = f"{title}\n\n{body}" if title else body
            elif "query" in parsed and isinstance(parsed["query"], dict):
                pages = parsed["query"].get("pages", {})
                if isinstance(pages, dict):
                    for page in pages.values():
                        if isinstance(page, dict) and page.get("revisions"):
                            rev = page["revisions"][0]
                            slots = rev.get("slots", {})
                            main_slot = slots.get("main", {}) if isinstance(slots, dict) else {}
                            content = main_slot.get("*") or rev.get("*") or ""
                            if content:
                                title = str(page.get("title", "")).strip()
                                text = f"{title}\n\n{content}" if title else str(content)
                                break
    except Exception:
        pass

    text = re.sub(r"<ref[^>]*>.*?</ref>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<ref[^>]*/\s*>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"\[\[([^|\]]+\|)?([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"'''?", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:max_chars]


class EvidenceProbe(gl.Contract):
    last_url: str
    last_sha256: str
    last_text_preview: str
    last_status_code: u256
    last_raw_len: u256
    last_extracted_len: u256
    probe_count: u256
    results: TreeMap[str, str]

    def __init__(self):
        self.last_url = ""
        self.last_sha256 = ""
        self.last_text_preview = ""
        self.last_status_code = u256(0)
        self.last_raw_len = u256(0)
        self.last_extracted_len = u256(0)
        self.probe_count = u256(0)

    @gl.public.write
    def probe_url(self, url: str) -> str:
        def _fetch_and_digest() -> str:
            response = gl.nondet.web.get(
                url,
                headers={"User-Agent": PROBE_USER_AGENT},
            )
            status_code = int(
                getattr(response, "status", getattr(response, "status_code", 0))
            )
            if status_code < 200 or status_code >= 300:
                raise gl.vm.UserError(f"HTTP_ERROR:{status_code}")

            raw_text = response.body.decode("utf-8", "replace")
            extracted = _extract_deterministic_text(raw_text, MAX_EXTRACTED_CHARS)
            if not extracted:
                raise gl.vm.UserError("EMPTY_EXTRACTED_TEXT")

            digest = hashlib.sha256(extracted.encode("utf-8")).hexdigest()
            return json.dumps(
                {
                    "url": url,
                    "status_code": status_code,
                    "raw_len": len(raw_text),
                    "extracted_len": len(extracted),
                    "sha256": digest,
                    "text": extracted,
                },
                sort_keys=True,
            )

        result_json = gl.eq_principle.strict_eq(_fetch_and_digest)
        parsed = json.loads(result_json)
        self.last_url = url
        self.last_sha256 = str(parsed["sha256"])
        self.last_text_preview = str(parsed["text"])[:300]
        self.last_status_code = u256(int(parsed["status_code"]))
        self.last_raw_len = u256(int(parsed["raw_len"]))
        self.last_extracted_len = u256(int(parsed["extracted_len"]))
        self.probe_count = u256(int(self.probe_count) + 1)
        self.results[url] = result_json
        return result_json

    @gl.public.view
    def get_last_result(self) -> str:
        return json.dumps(
            {
                "url": self.last_url,
                "sha256": self.last_sha256,
                "text_preview": self.last_text_preview,
                "status_code": int(self.last_status_code),
                "raw_len": int(self.last_raw_len),
                "extracted_len": int(self.last_extracted_len),
                "probe_count": int(self.probe_count),
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_result(self, url: str) -> str:
        return self.results.get(url, "")

    @gl.public.view
    def get_probe_count(self) -> int:
        return int(self.probe_count)
