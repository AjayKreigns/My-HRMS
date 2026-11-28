// Small pieces shared by the admin pages and Payroll. They live in their own file so that opening Payroll does not also
// download the leave, attendance and helpdesk admin screens (and the pages those import).
import { EmpChip, Btn, toast } from '../ui.jsx';
import { decide } from './Inbox.jsx';
import { empById, fullName } from '../utils.js';

export const empCol = (db, key = 'empId', label = 'Employee') => ({ key, label, sortValue: (r) => fullName(empById(db, r[key])), render: (r) => <EmpChip emp={empById(db, r[key])} />, csv: (r) => fullName(empById(db, r[key])) });

export function ApproveButtons({ db, user, col, row, kind }) {
  if (row.status !== 'Pending' && row.status !== 'Submitted') return null;
  const act = (status) => {
    let comment = '';
    if (status === 'Rejected') {
      comment = window.prompt('Reason for rejecting?') || '';
      if (!comment) return;
    }
    decide(db, { src: { col, kind }, row }, status, comment, user);
    toast(`${kind} ${status.toLowerCase()}`);
  };
  return (
    <span className="row-actions">
      <Btn kind="ghost" small onClick={() => act('Rejected')}>Reject</Btn>
      <Btn kind="success" small onClick={() => act('Approved')}>Approve</Btn>
    </span>
  );
}
