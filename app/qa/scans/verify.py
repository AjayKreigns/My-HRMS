"""Independent check of a payslip PDF: encrypted, opens with the right password only, text and layout readable.
Usage: python verify.py <pdf> <password> <png-out>"""
import sys
import fitz  # PyMuPDF

pdf, password, png = sys.argv[1:4]
doc = fitz.open(pdf)
print("encrypted:", doc.is_encrypted, "| needs password:", doc.needs_pass)
print("wrong password opens it:", bool(fitz.open(pdf).authenticate("wrong-password")))
ok = doc.authenticate(password)
print("right password opens it:", bool(ok), "(auth code", ok, ")")
print("pages:", doc.page_count)
page = doc[0]
text = page.get_text()
for needle in ["iFluids Engineering", "Payslip for", "Priya Raman", "Earnings", "Deductions", "Net pay", "INR"]:
    print(f"  contains {needle!r}:", needle in text)
print("images on page 1 (logo expected):", len(page.get_images()))
print("text length:", len(text))
page.get_pixmap(dpi=90).save(png)
print("saved", png)
open(png.replace(".png", ".txt"), "w", encoding="utf-8").write(text)
