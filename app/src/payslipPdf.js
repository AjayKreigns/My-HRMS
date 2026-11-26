// Payslip as a password-protected PDF. The password is the employee number followed by the date of birth (DDMMYYYY).
// jsPDF is loaded only when a PDF is asked for, so it does not weigh on the rest of the app.
import { fullName, fmtDate, monthLabel } from './utils.js';

export function payslipPassword(emp) {
  const dob = emp?.dob || '';
  return `${emp?.empNo || ''}${dob ? `${dob.slice(8, 10)}${dob.slice(5, 7)}${dob.slice(0, 4)}` : ''}`;
}
// The company logo goes on every payslip. It is read lazily, so a missing image never stops the PDF.
async function companyLogo() {
  try {
    const url = (await import('./assets/ifluids-logo.png')).default;
    const blob = await (await fetch(url)).blob();
    const data = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    return data;
  } catch {
    return null;
  }
}
const inr = (n) => `INR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export async function payslipPdf(db, slip) {
  const { jsPDF } = await import('jspdf');
  const e = slip.emp;
  const pw = payslipPassword(e);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', ...(pw ? { encryption: { userPassword: pw, ownerPassword: `${pw}#${e.id}#owner`, userPermissions: ['print'] } } : {}) });
  const W = doc.internal.pageSize.getWidth();
  let y = 50;
  const text = (t, x, size = 10, style = 'normal', align = 'left') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.text(String(t), x, y, { align });
  };
  const logo = await companyLogo();
  const left = logo ? 40 + 112 : 40;
  if (logo) {
    doc.addImage(logo, 'PNG', 40, 26, 100, 35);
    y = 44;
  }
  text(db.company.name, left, 16, 'bold');
  text(`Payslip for ${monthLabel(slip.ym)}`, W - 40, 12, 'bold', 'right');
  y += 16;
  text([db.company.address, db.company.city].filter(Boolean).join(', '), left, 9);
  y += logo ? 30 : 24;
  const info = [
    ['Employee', fullName(e)], ['Employee no', e.empNo], ['Job title', e.designation], ['Department', e.department],
    ['PAN', e.pan || '—'], ['UAN', e.uan || '—'], ['Pay group', slip.payGroup || '—'], ['Paid days', `${slip.paidDays} of ${slip.dim}`],
  ];
  info.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? 40 : W / 2 + 10;
    if (i % 2 === 0 && i > 0) y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(k, x, y);
    doc.setTextColor(0);
    doc.text(String(v ?? ''), x + 90, y);
  });
  y += 30;
  const table = (title, rows, x, w) => {
    let yy = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title, x, yy);
    yy += 6;
    doc.line(x, yy, x + w, yy);
    yy += 14;
    rows.forEach(([k, v]) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(String(k), x, yy);
      doc.text(inr(v), x + w, yy, { align: 'right' });
      yy += 15;
    });
    return yy;
  };
  const half = (W - 100) / 2;
  const endA = table('Earnings', slip.earnings, 40, half);
  const endB = table('Deductions', slip.deductions, 60 + half, half);
  y = Math.max(endA, endB) + 4;
  doc.line(40, y, W - 40, y);
  y += 16;
  text('Gross earnings', 40, 10, 'bold');
  text(inr(slip.gross), 40 + half, 10, 'bold', 'right');
  text('Total deductions', 60 + half, 10, 'bold');
  text(inr(slip.totalDed), W - 40, 10, 'bold', 'right');
  y += 28;
  doc.setFillColor(238, 242, 255);
  doc.rect(40, y - 16, W - 80, 30, 'F');
  text('Net pay', 52, 12, 'bold');
  text(inr(slip.net), W - 52, 12, 'bold', 'right');
  y += 40;
  text(`Tax regime: ${slip.regime}. This is a system-generated payslip and does not need a signature.`, 40, 8);
  y += 12;
  text(`Generated ${fmtDate(new Date().toISOString().slice(0, 10))}`, 40, 8);
  return doc;
}

export async function downloadPayslipPdf(db, slip) {
  const doc = await payslipPdf(db, slip);
  doc.save(`Payslip_${slip.emp.empNo}_${slip.ym}.pdf`);
}
