#!/usr/bin/env python3
"""
CapCut STT Wrapper for Sleiz Studio
====================================

Based on K07VN/capcut-tts-api (https://github.com/K07VN/capcut-tts-api) — MIT.

The legacy CapCut STT API (vod-api.capcut.com + api.capcut.com, used by v1 wrappers)
was deprecated and no longer resolves on public DNS. This wrapper uses the **new
Singapore endpoint** (editor-api-sg.capcutapi.com) with the following flow:

  1. POST /lv/v1/upload_sign            → get AWS SigV4 creds + VOD domain
  2. GET  /top/v1?Action=ApplyUploadInner  (AWS SigV4) → upload URL + VID
  3. POST /upload/v1/<store_uri> (transfer, CRC32) → upload binary
  4. POST /upload/v1/<store_uri> (finish) → finalize part
  5. POST /top/v1?Action=CommitUploadInner (AWS SigV4) → finalize session, get duration
  6. POST /lv/v1/common_task/new (req_key=cc_audio_subtitle_asr) → create STT task
  7. POST /lv/v1/common_task/query                              → poll for subtitles

CLI (backwards compatible with the old wrapper):
  python capcut_stt_wrapper.py transcribe <audio_file> [language]
  python capcut_stt_wrapper.py query <task_id> <token>
"""

import base64
import binascii
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

try:
    import requests
except ImportError:
    requests = None  # type: ignore[assignment]


def _configure_stdio() -> None:
    """Force UTF-8 stdio on Windows so subtitle JSON can be printed safely."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="backslashreplace")
            except Exception:
                pass


# ============================================================================
# Constants
# ============================================================================

BASE_URL = "https://editor-api-sg.capcutapi.com"
VOD_REGION = "sdwdmwlll"
VOD_SERVICE = "vod"

DEFAULT_DEVICE: Dict[str, str] = {
    "aid": "359289",
    "app_name": "CapCut",
    "appvr": "8.7.0",
    "version_name": "8.7.0",
    "version_code": "8.7.0",
    "channel": "capcutpc_google",
    "device_platform": "mac",
    "device_type": "MacBookPro17,4",
    "device_brand": "MacBookPro17,4",
    "os_version": "15.7.4",
    "device_id": "7647183892936328721",
    "iid": "7647185302080423697",
    "region": "VN",
    "loc": "VN",
    "lan": "vi-VN",
    "pf": "3",
    "tdid": "7647183892936328721",
}

TTS_SIGN_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTd34Lw4b7IuldSXh/zY
CMla+ITdGG5TeWz6ad+OySd4r+IrY45AoqrYUxhQ2dl+7z+i7r/5vEa8rr39BYfB
8AGMQLmZA8HmgpWBsqrn/V6daUALkKnkLb70Fn32CJigIuGXAYqxUdGuI340aC+0
v5Es3puJsHyzf01/AelE4Cdc6bZhQrASJLBh8R3BQToYClmDVSDUQk28o8sl/guA
Z4n303Vj+6Siv1HayPCdV6kpVVnMBAG4+umUbwGmn132N3fgpzLarFF3XyWmS1zh
D/J07iM/rP8GDO9IskHNHd2phrO0G6KzrcFAnTBHjVv+hCBEfzN/no3FNA9AuC36
mwIDAQAB
-----END PUBLIC KEY-----"""


# ============================================================================
# Exceptions
# ============================================================================

class CapCutError(Exception):
    """Generic CapCut API error."""


class CapCutAPIError(CapCutError):
    """Non-2xx HTTP response or malformed JSON from CapCut API."""

    def __init__(self, message: str, status_code: Optional[int] = None, response_data: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_data = response_data


class CapCutUploadError(CapCutError):
    """File upload to VOD failed."""


class CapCutTaskError(CapCutError):
    """STT/TTS task itself failed (not the HTTP request)."""


class CapCutSignError(CapCutError):
    """Request signing failed."""


# ============================================================================
# Helpers — JSON, hashing, escaping
# ============================================================================

def compact_json(obj: Any) -> str:
    """Format python object into compact JSON (no whitespace between separators)."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def make_x_ss_stub(body_text: str) -> str:
    """Generate x-ss-stub header value (MD5 of request body)."""
    return hashlib.md5(body_text.encode("utf-8")).hexdigest()


def make_trace_id() -> str:
    """Generate a W3C traceparent header value."""
    seed = uuid.uuid4().hex[:32]
    return f"00-{seed}-{seed[:16]}-01"


def escape_xml(text: str) -> str:
    """Escape special XML characters for SSML generation."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def sha256_hex(data: Union[str, bytes]) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def hmac_sha256(key: Union[str, bytes], msg: Union[str, bytes]) -> bytes:
    if isinstance(key, str):
        key = key.encode("utf-8")
    if isinstance(msg, str):
        msg = msg.encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).digest()


def file_md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def crc32_hex(data: bytes) -> str:
    return f"{binascii.crc32(data) & 0xFFFFFFFF:08x}"


# ============================================================================
# RSA PKCS#1 v1.5 (pure Python, no `cryptography` lib needed)
# ============================================================================

def _der_len(data: bytes, pos: int) -> Tuple[int, int]:
    first = data[pos]
    pos += 1
    if first < 0x80:
        return first, pos
    nbytes = first & 0x7F
    return int.from_bytes(data[pos : pos + nbytes], "big"), pos + nbytes


def _der_value(data: bytes, pos: int, tag: int) -> Tuple[bytes, int]:
    if data[pos] != tag:
        raise CapCutSignError(f"Bad DER tag: expected 0x{tag:02x}, got 0x{data[pos]:02x}")
    length, pos = _der_len(data, pos + 1)
    return data[pos : pos + length], pos + length


def _der_int(data: bytes, pos: int) -> Tuple[int, int]:
    raw, pos = _der_value(data, pos, 0x02)
    return int.from_bytes(raw.lstrip(b"\x00"), "big"), pos


def rsa_public_numbers_from_pem(pem: str) -> Tuple[int, int]:
    """Parse RSA modulus and exponent from a PEM-formatted public key."""
    try:
        b64 = "".join(line for line in pem.splitlines() if not line.startswith("-----"))
        der = base64.b64decode(b64)
        outer, pos = _der_value(der, 0, 0x30)
        if pos != len(der):
            raise CapCutSignError("Trailing data in public key")
        _, pos = _der_value(outer, 0, 0x30)  # AlgorithmIdentifier
        bit_string, pos = _der_value(outer, pos, 0x03)
        if pos != len(outer) or not bit_string or bit_string[0] != 0:
            raise CapCutSignError("Bad subjectPublicKeyInfo")
        rsa_seq, pos = _der_value(bit_string[1:], 0, 0x30)
        if pos != len(bit_string[1:]):
            raise CapCutSignError("Trailing data in RSA public key")
        modulus, pos = _der_int(rsa_seq, 0)
        exponent, pos = _der_int(rsa_seq, pos)
        if pos != len(rsa_seq):
            raise CapCutSignError("Trailing integer data in RSA public key")
        return modulus, exponent
    except Exception as exc:
        if isinstance(exc, CapCutSignError):
            raise
        raise CapCutSignError(f"Failed to parse RSA PEM public key: {exc}") from exc


def rsa_encrypt_pkcs1v15(message: Union[str, bytes], pem: str = TTS_SIGN_PUBLIC_KEY_PEM) -> str:
    """Encrypt message using RSA PKCS#1 v1.5; returns Base64-encoded ciphertext."""
    modulus, exponent = rsa_public_numbers_from_pem(pem)
    key_len = (modulus.bit_length() + 7) // 8
    msg = message.encode("utf-8") if isinstance(message, str) else bytes(message)
    if len(msg) > key_len - 11:
        raise CapCutSignError("Message too long for RSA PKCS#1 v1.5 padding")
    ps_len = key_len - len(msg) - 3
    ps = bytearray()
    while len(ps) < ps_len:
        chunk = secrets.token_bytes(ps_len - len(ps))
        ps.extend(b for b in chunk if b != 0)
    encoded = b"\x00\x02" + bytes(ps[:ps_len]) + b"\x00" + msg
    encrypted = pow(int.from_bytes(encoded, "big"), exponent, modulus).to_bytes(key_len, "big")
    return base64.b64encode(encrypted).decode("ascii")


# ============================================================================
# AWS SigV4 (for VOD upload)
# ============================================================================

def aws4_signing_key(secret_access_key: str, date_stamp: str) -> bytes:
    k_date = hmac_sha256("AWS4" + secret_access_key, date_stamp)
    k_region = hmac_sha256(k_date, VOD_REGION)
    k_service = hmac_sha256(k_region, VOD_SERVICE)
    return hmac_sha256(k_service, "aws4_request")


def canonical_query(url: str) -> str:
    pairs = parse_qsl(urlsplit(url).query, keep_blank_values=True)
    return "&".join(
        quote(str(k), safe="-_.~") + "=" + quote(str(v), safe="-_.~") for k, v in sorted(pairs)
    )


def aws4_authorization(
    method: str,
    url: str,
    body: bytes,
    access_key_id: str,
    secret_access_key: str,
    session_token: str,
    amz_date: str,
) -> str:
    date_stamp = amz_date[:8]
    scope = f"{date_stamp}/{VOD_REGION}/{VOD_SERVICE}/aws4_request"
    signed_headers = "x-amz-date;x-amz-security-token"
    canonical_headers = f"x-amz-date:{amz_date}\nx-amz-security-token:{session_token}\n"
    canonical_request = "\n".join(
        [method, urlsplit(url).path, canonical_query(url), canonical_headers, signed_headers, sha256_hex(body)]
    )
    string_to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, sha256_hex(canonical_request)]
    )
    signature = hmac.new(
        aws4_signing_key(secret_access_key, date_stamp),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return (
        f"AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )


def utc_now_for_vod() -> Tuple[str, str]:
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%a, %d %b %Y %H:%M:%S GMT")


# ============================================================================
# CapCut API signing & headers
# ============================================================================

def make_sign_header(url: str, appvr: str, device_time: str, tdid: str) -> str:
    """Generate CapCut's HTTP `sign` header (MD5 of a path-tail + metadata)."""
    path = url.split("?", 1)[0]
    sign_str = f"9e2c|{path[-7:]}|3|{appvr}|{device_time}|{tdid}|11ac"
    return hashlib.md5(sign_str.encode("utf-8")).hexdigest()


def common_query(device: Dict[str, str], babi_param: Any = None, include_region: bool = True) -> Dict[str, str]:
    q: Dict[str, str] = {
        "app_name": device["app_name"],
        "device_type": device["device_type"],
        "os_version": device["os_version"],
        "channel": device["channel"],
        "version_name": device["version_name"],
        "device_brand": device["device_brand"],
        "device_id": device["device_id"],
        "iid": device["iid"],
        "version_code": device["version_code"],
        "device_platform": device["device_platform"],
        "aid": device["aid"],
    }
    if include_region:
        q["region"] = device["region"]
    if babi_param is not None:
        q["babi_param"] = compact_json(babi_param)
    return q


def base_headers(device: Dict[str, str], body_text: str, appid: bool = False) -> Dict[str, str]:
    now = str(int(time.time()))
    headers: Dict[str, str] = {
        "content-type": "application/json",
        "appvr": device["appvr"],
        "ch": device["channel"],
        "device-time": now,
        "lan": device["lan"],
        "loc": device["loc"],
        "pf": device["pf"],
        "sign-ver": "1",
        "tdid": device["tdid"],
        "x-ss-stub": make_x_ss_stub(body_text),
        "x-ss-dp": device["aid"],
        "x-khronos": now,
        "x-tt-trace-id": make_trace_id(),
        "user-agent": "Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03",
        "accept-encoding": "gzip, deflate",
        "store-country-code": device["loc"].lower(),
        "store-country-code-src": "did",
        "is-dispatch-us-ttp": "0",
        "is-app-region-us-ttp": "0",
    }
    if appid:
        headers["app-sdk-version"] = device["appvr"]
        headers["appid"] = device["aid"]
    return headers


def _check_response(resp: Any, label: str) -> Dict[str, Any]:
    try:
        data = resp.json()
    except Exception as exc:
        raise CapCutAPIError(
            f"{label} returned non-JSON HTTP {resp.status_code}: {resp.text[:500]}",
            status_code=resp.status_code,
        ) from exc
    if resp.status_code >= 400:
        raise CapCutAPIError(
            f"{label} HTTP {resp.status_code}: {data}",
            status_code=resp.status_code,
            response_data=data,
        )
    return data


# ============================================================================
# VOD Uploader (AWS SigV4 signed)
# ============================================================================

class VODUploader:
    """Handles chunked media upload to CapCut VOD space using AWS SigV4."""

    def __init__(self, device: Dict[str, str], session: Any = None):
        self.device = device
        self.session = session or (requests.Session() if requests else None)

    def _vod_signed_headers(self, method: str, url: str, body: bytes, creds: Dict[str, str]) -> Dict[str, str]:
        amz_date, http_date = utc_now_for_vod()
        return {
            "Authorization": aws4_authorization(
                method, url, body,
                creds["access_key_id"],
                creds["secret_access_key"],
                creds["session_token"],
                amz_date,
            ),
            "Date": http_date,
            "User-Agent": f"BDFileUpload({int(time.time() * 1000)})",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": "31536000",
            "X-Amz-Security-Token": creds["session_token"],
            "accept-encoding": "identity",
            "store-country-code": self.device["loc"].lower(),
            "store-country-code-src": "did",
            "is-dispatch-us-ttp": "0",
            "is-app-region-us-ttp": "0",
            "tdid": self.device["tdid"],
            "pf": self.device["pf"],
        }

    def _upload_binary_headers(self, auth: str, crc32: str) -> Dict[str, str]:
        headers: Dict[str, str] = {
            "Authorization": auth,
            "Date": utc_now_for_vod()[1],
            "User-Agent": f"BDFileUpload({int(time.time() * 1000)})",
            "accept-encoding": "identity",
            "store-country-code": self.device["loc"].lower(),
            "store-country-code-src": "did",
            "is-dispatch-us-ttp": "0",
            "is-app-region-us-ttp": "0",
            "tdid": self.device["tdid"],
            "pf": self.device["pf"],
        }
        if crc32:
            headers["X-Upload-Content-CRC32"] = crc32
        return headers

    def _upload_sign_request(self) -> Tuple[str, Dict[str, str], str]:
        body = {"biz": "cc_pc_text_recognize", "key_version": "v5"}
        body_text = compact_json(body)
        path = "/lv/v1/upload_sign"
        query = common_query(self.device, None, include_region=False)
        url = BASE_URL + path + "?" + urlencode(query)
        headers = base_headers(self.device, body_text, appid=True)
        lower_headers = {k.lower(): v for k, v in headers.items()}
        if "sign" not in lower_headers:
            headers["sign"] = make_sign_header(
                url, self.device["appvr"], lower_headers["device-time"], self.device["tdid"]
            )
        return url, headers, body_text

    def upload_file(self, file_path: Union[str, Path]) -> Dict[str, Any]:
        """Upload a media file to VOD. Returns dict with vid, md5, duration_ms, etc."""
        if requests is None:
            raise CapCutUploadError("The 'requests' package is required. pip install requests")

        path_obj = Path(file_path)
        if not path_obj.exists():
            raise CapCutUploadError(f"File not found: {file_path}")

        path_str = str(path_obj)
        local_md5 = file_md5(path_str)
        with open(path_str, "rb") as fp:
            data = fp.read()
        part_crc32 = crc32_hex(data)
        print(f"[CapCut STT] Uploading {len(data)} bytes (md5={local_md5[:8]}..., crc32={part_crc32})...", file=sys.stderr)

        # 1. upload_sign — get AWS SigV4 creds + VOD domain
        url, headers, body_text = self._upload_sign_request()
        sign_resp = self.session.post(url, headers=headers, data=body_text.encode("utf-8"), timeout=60)
        sign_data = _check_response(sign_resp, "upload_sign")
        creds = sign_data.get("data") or {}
        for key in ("domain", "access_key_id", "secret_access_key", "session_token", "space_name"):
            if not creds.get(key):
                raise CapCutUploadError(f"upload_sign missing required field '{key}': {sign_data}")

        # 2. ApplyUploadInner — get upload URL + VID
        apply_url = f"https://{creds['domain']}/top/v1?" + urlencode({
            "Action": "ApplyUploadInner",
            "SpaceName": creds["space_name"],
            "UseQuic": "false",
            "Version": "2020-11-19",
            "device_platform": "win",
        })
        apply_resp = self.session.get(
            apply_url,
            headers=self._vod_signed_headers("GET", apply_url, b"", creds),
            timeout=60,
        )
        apply_data = _check_response(apply_resp, "ApplyUploadInner")
        node = apply_data["Result"]["InnerUploadAddress"]["UploadNodes"][0]
        store = node["StoreInfos"][0]
        upload_host = node["UploadHost"]
        store_uri = store["StoreUri"]
        upload_id = store["UploadID"]
        upload_auth = store["Auth"]
        vid = node.get("Vid") or (node.get("Vids") or [None])[0]
        print(f"[CapCut STT] VOD VID: {vid}", file=sys.stderr)

        # 3. Transfer binary
        transfer_url = f"https://{upload_host}/upload/v1/{store_uri}?" + urlencode({
            "uploadid": upload_id, "part_number": "0", "phase": "transfer",
        })
        transfer_resp = self.session.post(
            transfer_url,
            headers=self._upload_binary_headers(upload_auth, part_crc32),
            data=data,
            timeout=300,
        )
        _check_response(transfer_resp, "upload transfer")

        # 4. Finish upload
        finish_url = f"https://{upload_host}/upload/v1/{store_uri}?" + urlencode({
            "uploadmode": "part", "phase": "finish", "uploadid": upload_id,
        })
        finish_body = f"0:{part_crc32}"
        finish_resp = self.session.post(
            finish_url,
            headers=self._upload_binary_headers(upload_auth, ""),
            data=finish_body.encode("utf-8"),
            timeout=60,
        )
        _check_response(finish_resp, "upload finish")

        # 5. CommitUploadInner — finalize session, get video metadata
        commit_url = f"https://{creds['domain']}/top/v1?" + urlencode({
            "Action": "CommitUploadInner",
            "SpaceName": creds["space_name"],
            "Version": "2020-11-19",
            "device_platform": "win",
        })
        commit_body = compact_json({
            "Functions": [{"Input": {"SnapshotTime": 0.0}, "Name": "Snapshot"}],
            "SessionKey": node["SessionKey"],
        })
        commit_resp = self.session.post(
            commit_url,
            headers=self._vod_signed_headers("POST", commit_url, commit_body.encode("utf-8"), creds),
            data=commit_body.encode("utf-8"),
            timeout=120,
        )
        commit_data = _check_response(commit_resp, "CommitUploadInner")
        result = commit_data["Result"]["Results"][0]
        meta = result.get("VideoMeta") or {}
        duration_ms = int(float(meta.get("Duration") or 0) * 1000) if meta.get("Duration") is not None else 0

        return {
            "vid": result.get("Vid") or vid,
            "md5": meta.get("Md5") or local_md5,
            "local_md5": local_md5,
            "duration_ms": duration_ms,
            "format": meta.get("Format"),
            "size": meta.get("Size") or len(data),
            "file_type": meta.get("FileType"),
            "store_uri": meta.get("Uri") or store_uri,
        }


# ============================================================================
# STT Task API
# ============================================================================

def _build_stt_new_request(
    device: Dict[str, str],
    audio_vid: str,
    audio_md5: str,
    duration_ms: int,
    language: str,
    translation_language: str,
    use_translation: bool,
) -> Tuple[str, Dict[str, str], str]:
    babi = {
        "feature_entrance": "editor",
        "feature_entrance_detail": "editor-elements-captions-subtitle_recognition",
        "feature_key": "subtitle_recognition",
        "scenario": "video_editor",
    }
    cap_json: Dict[str, Any] = {
        "adjust_endtime": 200,
        "audio": audio_vid,
        "audio_type": "vid",
        "caption_type": 0,
        "client_request_id": str(uuid.uuid4()),
        "duration": int(duration_ms),
        "enable_cache": True,
        "enter_from": "asr",
        "language": language,
        "max_lines": 1,
        "md5": audio_md5,
        "pack_options": {"need_attribute": True},
        "songs_info": [
            {"end_time": float(duration_ms) - 10.334, "id": "", "start_time": 0}
        ],
        "translation_language": translation_language,
        "use_translation": bool(use_translation),
        "words_per_line": 15,
    }
    body = {
        "bind_id": str(uuid.uuid4()).upper(),
        "can_queue": True,
        "enter_from": "asr",
        "tasks": [
            {
                "context": str(uuid.uuid4()),
                "payload": compact_json({"cap_json": cap_json}),
                "req_key": "cc_audio_subtitle_asr",
                "task_version": "v3",
            }
        ],
    }
    body_text = compact_json(body)
    path = "/lv/v1/common_task/new"
    query = common_query(device, babi, include_region=True)
    url = BASE_URL + path + "?" + urlencode(query)
    headers = base_headers(device, body_text, appid=False)
    lower_headers = {k.lower(): v for k, v in headers.items()}
    if "sign" not in lower_headers:
        headers["sign"] = make_sign_header(
            url, device["appvr"], lower_headers["device-time"], device["tdid"]
        )
    return url, headers, body_text


def _build_query_request(
    device: Dict[str, str],
    task_id: str,
    token: str,
    bind_id: str = "",
) -> Tuple[str, Dict[str, str], str]:
    body = {
        "tasks": [
            {
                "bind_id": bind_id,
                "id": task_id,
                "req_key": "cc_audio_subtitle_asr",
                "task_version": "v3",
                "token": token,
            }
        ]
    }
    body_text = compact_json(body)
    path = "/lv/v1/common_task/query"
    query = common_query(device, None, include_region=False)
    url = BASE_URL + path + "?" + urlencode(query)
    headers = base_headers(device, body_text, appid=False)
    lower_headers = {k.lower(): v for k, v in headers.items()}
    if "sign" not in lower_headers:
        headers["sign"] = make_sign_header(
            url, device["appvr"], lower_headers["device-time"], device["tdid"]
        )
    return url, headers, body_text


# ============================================================================
# Subtitle parsing
# ============================================================================

def _ms_to_srt_time(ms: int) -> str:
    seconds = ms // 1000
    millis = ms % 1000
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _normalize_task_status(status: Any) -> str:
    raw = str(status or "").strip().lower()
    if raw in {"success", "succeed", "done", "completed", "complete", "finished"}:
        return "completed"
    if raw in {"failed", "fail", "error", "canceled", "cancelled", "timeout", "timed_out"}:
        return "failed"
    if raw in {"processing", "queueing", "queued", "queue", "pending", "running", "in_progress"}:
        return "processing"
    return raw or "processing"


def _coerce_json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except Exception:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _extract_query_payload(task: Dict[str, Any]) -> Dict[str, Any]:
    candidates: List[Any] = [
        task.get("payload"),
        task.get("result"),
        task.get("output"),
        task.get("data"),
    ]
    for candidate in candidates:
        payload = _coerce_json_object(candidate)
        if not payload:
            continue
        if payload.get("utterances"):
            return payload
        nested = _coerce_json_object(payload.get("payload"))
        if nested.get("utterances"):
            return nested
        if "utterances" in payload or "duration" in payload:
            return payload
        if nested:
            return nested
    return {}


def _extract_srt_from_query_response(query_response: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], int]:
    """Parse the new query response shape (tasks[].payload.utterances[])."""
    tasks = (query_response.get("data") or {}).get("tasks") or []
    if not tasks:
        return "", [], 0

    task = tasks[0]
    if _normalize_task_status(task.get("status")) != "completed":
        return "", [], 0

    payload = _extract_query_payload(task)
    if not payload:
        return "", [], 0
    raw_utterances = payload.get("utterances") or []
    duration_ms = int(payload.get("duration") or task.get("duration") or 0)

    srt_lines: List[str] = []
    out_utterances: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_utterances, 1):
        text = (item.get("text") or "").strip()
        if not text:
            continue
        start_ms = int(item.get("start_time") or 0)
        end_ms = int(item.get("end_time") or 0)
        srt_lines.append(f"{idx}")
        srt_lines.append(f"{_ms_to_srt_time(start_ms)} --> {_ms_to_srt_time(end_ms)}")
        srt_lines.append(text)
        srt_lines.append("")
        out_utterances.append({"start_time": start_ms, "end_time": end_ms, "text": text})

    return "\n".join(srt_lines).rstrip("\n"), out_utterances, duration_ms


def _build_query_result(query_response: Dict[str, Any], task_id: str) -> Dict[str, Any]:
    tasks = (query_response.get("data") or {}).get("tasks") or []
    if not tasks:
        return {"task_id": task_id, "status": "processing"}

    task = tasks[0]
    status = _normalize_task_status(task.get("status"))
    result: Dict[str, Any] = {
        "task_id": task.get("id") or task_id,
        "status": status,
    }
    if status == "completed":
        srt, utterances, duration_ms = _extract_srt_from_query_response(query_response)
        result["srt"] = srt
        result["utterances"] = utterances
        result["duration_ms"] = duration_ms
    elif status == "failed":
        result["error"] = task.get("message") or task.get("err_msg") or compact_json(task)
    return result


# ============================================================================
# High-level STT client
# ============================================================================

class CapCutSTTClient:
    """Speech-to-Text client for CapCut (Singapore endpoint)."""

    def __init__(self, device: Optional[Dict[str, str]] = None, session: Any = None):
        self.device = dict(DEFAULT_DEVICE)
        if device:
            self.device.update(device)
        self.session = session or (requests.Session() if requests else None)

    def upload_audio(self, file_path: Union[str, Path]) -> Dict[str, Any]:
        uploader = VODUploader(self.device, session=self.session)
        return uploader.upload_file(file_path)

    def create_stt_task(
        self,
        audio_vid: str,
        audio_md5: str,
        duration_ms: int = 10000,
        language: str = "zh-CN",
        translation_language: str = "vi-VN",
        use_translation: bool = False,
    ) -> Dict[str, Any]:
        if self.session is None:
            raise CapCutError("The 'requests' package is required. pip install requests")
        url, headers, body_text = _build_stt_new_request(
            self.device, audio_vid, audio_md5, duration_ms, language, translation_language, use_translation
        )
        resp = self.session.post(url, headers=headers, data=body_text.encode("utf-8"), timeout=60)
        return _check_response(resp, "create_stt_task")

    def query_stt_task(self, task_id: str, token: str, bind_id: str = "") -> Dict[str, Any]:
        if self.session is None:
            raise CapCutError("The 'requests' package is required. pip install requests")
        url, headers, body_text = _build_query_request(self.device, task_id, token, bind_id)
        resp = self.session.post(url, headers=headers, data=body_text.encode("utf-8"), timeout=60)
        return _check_response(resp, "query_stt_task")

    def transcribe_file(
        self,
        file_path: Union[str, Path],
        language: str = "zh-CN",
        translation_language: str = "vi-VN",
        use_translation: bool = False,
        wait: bool = True,
        poll_interval: float = 2.0,
        timeout: float = 600.0,
    ) -> Dict[str, Any]:
        """Upload, create STT task, poll until completion. Returns dict with srt, task_id, token, vid, status, utterances, duration_ms."""
        print(f"[CapCut STT] Transcribing: {file_path} (lang={language})", file=sys.stderr)

        upload = self.upload_audio(file_path)
        vid = upload["vid"]
        md5 = upload["md5"]
        duration_ms = upload.get("duration_ms") or 10000

        create_res = self.create_stt_task(
            audio_vid=vid,
            audio_md5=md5,
            duration_ms=duration_ms,
            language=language,
            translation_language=translation_language,
            use_translation=use_translation,
        )
        tasks = (create_res.get("data") or {}).get("tasks") or []
        if not tasks:
            raise CapCutTaskError(f"No STT task returned: {create_res}")
        task_id = tasks[0]["id"]
        token = tasks[0]["token"]
        print(f"[CapCut STT] Task created: {task_id}", file=sys.stderr)

        if not wait:
            return {
                "task_id": task_id,
                "token": token,
                "vid": vid,
                "status": "processing",
            }

        # Poll
        start = time.time()
        while time.time() - start < timeout:
            query_res = self.query_stt_task(task_id, token)
            qtasks = (query_res.get("data") or {}).get("tasks") or []
            if qtasks:
                raw_status = qtasks[0].get("status")
                status = _normalize_task_status(raw_status)
                elapsed = int(time.time() - start)
                print(f"[CapCut STT] status={raw_status} normalized={status} elapsed={elapsed}s", file=sys.stderr)
                if status == "completed":
                    srt, utterances, dur = _extract_srt_from_query_response(query_res)
                    if not srt and not utterances:
                        print("[CapCut STT] Task marked completed but subtitle payload is empty; polling again...", file=sys.stderr)
                        time.sleep(poll_interval)
                        continue
                    return {
                        "task_id": task_id,
                        "token": token,
                        "vid": vid,
                        "status": "completed",
                        "srt": srt,
                        "utterances": utterances,
                        "duration_ms": dur,
                    }
                if status == "failed":
                    raise CapCutTaskError(f"STT task failed: {query_res}")
            time.sleep(poll_interval)

        raise CapCutTaskError(f"STT task timed out after {timeout}s")


# ============================================================================
# CLI entrypoint — backwards compatible with the old wrapper's interface
# ============================================================================

def main() -> int:
    _configure_stdio()

    if len(sys.argv) < 2:
        print("Usage: python capcut_stt_wrapper.py <command> [args]", file=sys.stderr)
        print("Commands:", file=sys.stderr)
        print("  transcribe <audio_file> [language] [translation_language] [use_translation]", file=sys.stderr)
        print("  query <task_id> <token>", file=sys.stderr)
        return 1

    # Optional device override from env JSON
    env_device = os.environ.get("CAPCUT_DEVICE_JSON")
    device_override: Optional[Dict[str, str]] = None
    if env_device:
        try:
            device_override = json.loads(env_device)
        except Exception as exc:
            print(f"[CapCut STT] bad CAPCUT_DEVICE_JSON: {exc}", file=sys.stderr)

    client = CapCutSTTClient(device=device_override)

    command = sys.argv[1]
    try:
        if command == "transcribe":
            if len(sys.argv) < 3:
                print("Usage: transcribe <audio_file> [language]", file=sys.stderr)
                return 1
            audio_file = sys.argv[2]
            language = sys.argv[3] if len(sys.argv) > 3 else "zh-CN"
            translation_language = sys.argv[4] if len(sys.argv) > 4 else "vi-VN"
            use_translation = (sys.argv[5].lower() in ("1", "true", "yes")) if len(sys.argv) > 5 else False

            result = client.transcribe_file(
                audio_file,
                language=language,
                translation_language=translation_language,
                use_translation=use_translation,
                wait=True,
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0

        if command == "query":
            if len(sys.argv) < 4:
                print("Usage: query <task_id> <token>", file=sys.stderr)
                return 1
            raw_result = client.query_stt_task(sys.argv[2], sys.argv[3])
            result = _build_query_result(raw_result, sys.argv[2])
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0

        print(f"Unknown command: {command}", file=sys.stderr)
        return 1

    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
