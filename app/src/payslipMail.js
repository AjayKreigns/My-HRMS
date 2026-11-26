// Payslip email. Nothing is sent from the browser: when payroll is released each payslip is put in an outbox, and a mail
// service (SMTP) takes it from there once it is connected. The SMTP password is never kept in the app's data.
export const MAIL_DEFAULTS = {
  enabled: false, // switch on once the mail service is connected
  host: '',
  port: 587,
  security: 'STARTTLS', // STARTTLS | SSL/TLS | None
  user: '',
  fromName: 'iFluids Engineering Payroll',
  fromEmail: '',
  subject: 'Your payslip for {month}',
  body: 'Hi {name},\n\nYour payslip for {month} is attached. The PDF opens with your employee number followed by your date of birth as DDMMYYYY (for example, employee E102 born on 20 January 1990 uses E10220011990).\n\nRegards,\niFluids Engineering',
};
export const mailSettings = (db) => ({ ...MAIL_DEFAULTS, ...(db?.payrollSettings?.mail || {}) });
export const smtpReady = (m) => !!(m.enabled && m.host && m.fromEmail);

// Put one payslip per paid employee in the outbox for a month. People already queued for that month are skipped.
export function queuePayslipMail(d, ym, people) {
  const m = mailSettings(d);
  const status = smtpReady(m) ? 'Queued' : 'Waiting for mail service';
  d.payslipOutbox = d.payslipOutbox || [];
  let added = 0;
  people.forEach((e) => {
    if (d.payslipOutbox.some((x) => x.empId === e.id && x.month === ym)) return;
    d.payslipOutbox.unshift({ id: `ml_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, empId: e.id, month: ym, to: e.workEmail || e.personalEmail || '', status: e.workEmail || e.personalEmail ? status : 'No email address', createdAt: new Date().toISOString() });
    added++;
  });
  d.payslipOutbox = d.payslipOutbox.slice(0, 2000);
  return added;
}
