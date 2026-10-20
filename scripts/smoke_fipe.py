from __future__ import annotations

import json
import os
from urllib.parse import urlencode

import requests

BASE = "https://placanamao.com.br"
s = requests.Session()
s.headers.update({"User-Agent": "placanamao-post-deploy-smoke/1.1"})


def get(path: str, **kwargs):
    response = s.get(BASE + path, timeout=30, **kwargs)
    print(f"GET {path} -> {response.status_code}")
    if response.status_code >= 400:
        print(response.text[:1000])
        raise SystemExit(1)
    return response


def post(path: str, payload: dict):
    response = s.post(BASE + path, json=payload, timeout=45)
    print(f"POST {path} -> {response.status_code}")
    if response.status_code >= 400:
        print(response.text[:1000])
        raise SystemExit(1)
    return response


health_json = get("/health").json()
assert health_json.get("ok") is True, health_json
status = get("/api/fipe/status").json()
assert status.get("enabled") is True, status
assert status.get("pdfEnabled") is True, status

references = get("/api/fipe/references").json()
assert references.get("references"), references
reference = references["references"][0]
reference_code = str(reference.get("code") or reference.get("value") or "")
assert reference_code, reference

query = urlencode({"vehicleType": "cars", "reference": reference_code})
brands = get(f"/api/fipe/brands?{query}").json()
brand = brands["brands"][0]
brand_code = str(brand.get("code") or brand.get("value") or "")
assert brand_code, brand

query = urlencode({"vehicleType": "cars", "brandCode": brand_code, "reference": reference_code})
models = get(f"/api/fipe/models?{query}").json()
model = models["models"][0]
model_code = str(model.get("code") or model.get("value") or "")
assert model_code, model

query = urlencode({"vehicleType": "cars", "brandCode": brand_code, "modelCode": model_code, "reference": reference_code})
years = get(f"/api/fipe/years?{query}").json()
year = years["years"][0]
year_code = str(year.get("code") or year.get("value") or "")
assert year_code, year

quote = post(
    "/api/fipe/quote",
    {
        "vehicleType": "cars",
        "brand": {"code": brand_code, "name": str(brand.get("name") or brand.get("text") or "")},
        "model": {"code": model_code, "name": str(model.get("name") or model.get("text") or "")},
        "year": {"code": year_code, "name": str(year.get("name") or year.get("text") or "")},
    },
).json()
assert quote.get("documentCode"), quote
assert quote.get("reportHash"), quote
assert quote.get("valueCents") is not None, quote
assert quote.get("valueLabel"), quote
assert "provider" not in quote and "source" not in quote, quote
assert "vehicleDetails" not in quote or isinstance(quote["vehicleDetails"], dict), quote

plate_smoke = os.getenv("PLATE_SMOKE", "").strip().upper()
plate_quote = None
if plate_smoke:
    plate_quote = post("/api/fipe/quote", {"plate": plate_smoke}).json()
    assert plate_quote.get("vehicleDetails"), plate_quote
    assert plate_quote["vehicleDetails"].get("plate"), plate_quote
    assert plate_quote.get("brand", {}).get("name"), plate_quote
    assert plate_quote.get("model", {}).get("name"), plate_quote
    assert plate_quote.get("year", {}).get("name"), plate_quote
    assert plate_quote.get("valueLabel"), plate_quote
    assert "provider" not in plate_quote and "source" not in plate_quote, plate_quote

offers = get("/api/fipe/offers").json()
assert offers.get("offers"), offers
for offer in offers["offers"]:
    assert "provider" not in offer and "source" not in offer and "coverage" not in offer, offer

report_code = quote["documentCode"]
validated = get(f"/api/validar-relatorio/{report_code}").json()
assert validated.get("authentic") is True, validated
assert validated.get("status") == "VALID", validated
assert "provider" not in validated, validated

printed = s.get(BASE + f"/api/fipe/reports/{report_code}/print", timeout=30)
print(f"GET /api/fipe/reports/{report_code}/print -> {printed.status_code}")
assert printed.status_code == 401, printed.text
pdf = s.get(BASE + f"/api/fipe/reports/{report_code}/pdf", timeout=30)
print(f"GET /api/fipe/reports/{report_code}/pdf -> {pdf.status_code}")
assert pdf.status_code == 401, pdf.text

assert b"provider" not in printed.content.lower() and b"source" not in printed.content.lower(), printed.text[:500]

print(json.dumps({
    "health": health_json,
    "reference": reference,
    "quote": {
        "documentCode": quote.get("documentCode"),
        "referenceMonth": quote.get("referenceMonth"),
        "valueCents": quote.get("valueCents"),
        "valueLabel": quote.get("valueLabel"),
        "vehicleDetails": quote.get("vehicleDetails"),
    },
    "offerCount": len(offers["offers"]),
    "reportValidation": validated,
    "anonymousPrintStatus": printed.status_code,
    "anonymousPdfStatus": pdf.status_code,
    "plateSmoke": plate_smoke or None,
    "plateQuote": {"vehicleDetails": plate_quote.get("vehicleDetails"), "valueLabel": plate_quote.get("valueLabel")} if plate_quote else None,
}, ensure_ascii=False, indent=2))
