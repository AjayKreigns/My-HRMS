// Sample data for a fresh install. Names and figures are fictional placeholders;
// the HR admin edits or replaces them from the Admin pages.
import { addDays, addMonths, iso, todayISO, ymOf } from './utils.js';

const COLORS = ['#5746af', '#0d9488', '#d97706', '#2563eb', '#db2777', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

const PEOPLE = [
  // id, first, last, gender, title, dept, manager, role, ctc, joined, email, status
  ['E100', 'Suresh', 'Narayanan', 'Male', 'Managing Partner', 'Management', null, 'admin', 4800000, '2009-06-01'],
  ['E101', 'Priya', 'Raman', 'Female', 'Head - Human Resources', 'Human Resources', 'E100', 'admin', 1800000, '2014-03-10', 'admin@ifluids.com'],
  ['E102', 'Karthik', 'Subramanian', 'Male', 'Head - Process Safety', 'Process Safety', 'E100', 'manager', 2600000, '2012-08-20', 'manager@ifluids.com'],
  ['E103', 'Anitha', 'Joseph', 'Female', 'Finance Manager', 'Finance & Accounts', 'E100', 'manager', 1600000, '2015-01-05'],
  ['E104', 'Vikram', 'Iyer', 'Male', 'Lead - HSE Consulting', 'HSE Consulting', 'E100', 'manager', 2100000, '2013-11-18'],
  ['E105', 'Meera', 'Krishnan', 'Female', 'Lead - Digital Solutions', 'Digital Solutions', 'E100', 'manager', 2200000, '2017-07-03'],
  ['E106', 'Arjun', 'Prakash', 'Male', 'Process Safety Engineer', 'Process Safety', 'E102', 'employee', 780000, '2022-02-14', 'employee@ifluids.com'],
  ['E107', 'Divya', 'Shankar', 'Female', 'Senior Process Safety Engineer', 'Process Safety', 'E102', 'employee', 1250000, '2018-09-24'],
  ['E108', 'Rahul', 'Menon', 'Male', 'HAZOP Facilitator', 'Process Safety', 'E102', 'employee', 1450000, '2016-04-11'],
  ['E109', 'Sneha', 'Pillai', 'Female', 'Process Engineer', 'Process Safety', 'E102', 'employee', 840000, '2021-06-07'],
  ['E110', 'Faizal', 'Ahmed', 'Male', 'HSE Consultant', 'HSE Consulting', 'E104', 'employee', 960000, '2019-10-01'],
  ['E111', 'Lakshmi', 'Venkat', 'Female', 'Fire & Gas Engineer', 'HSE Consulting', 'E104', 'employee', 1020000, '2020-01-20'],
  ['E112', 'Naveen', 'Babu', 'Male', 'Safety Auditor', 'HSE Consulting', 'E104', 'employee', 720000, '2023-03-15'],
  ['E113', 'Kavya', 'Reddy', 'Female', 'Software Developer', 'Digital Solutions', 'E105', 'employee', 900000, '2022-08-01'],
  ['E114', 'Sanjay', 'Gupta', 'Male', 'Data Analyst', 'Digital Solutions', 'E105', 'employee', 820000, '2023-01-09'],
  ['E115', 'Deepa', 'Mohan', 'Female', 'UI Designer', 'Digital Solutions', 'E105', 'employee', 760000, '2024-05-20'],
  ['E116', 'Harish', 'Chandran', 'Male', 'Accounts Executive', 'Finance & Accounts', 'E103', 'employee', 540000, '2021-12-01'],
  ['E117', 'Revathi', 'Sundar', 'Female', 'HR Executive', 'Human Resources', 'E101', 'admin', 600000, '2020-07-13'],
  ['E118', 'Manoj', 'Thomas', 'Male', 'Business Development Manager', 'Business Development', 'E100', 'manager', 1900000, '2015-10-26'],
  ['E119', 'Aishwarya', 'Nair', 'Female', 'Business Development Executive', 'Business Development', 'E118', 'employee', 650000, '2024-11-04'],
  ['E120', 'Ganesh', 'Murthy', 'Male', 'Admin Executive', 'Administration', 'E101', 'employee', 420000, '2019-02-18'],
  ['E121', 'Pooja', 'Desai', 'Female', 'Graduate Engineer Trainee', 'Process Safety', 'E102', 'employee', 360000, ''],
  ['E122', 'Imran', 'Sheikh', 'Male', 'Process Safety Engineer', 'Process Safety', 'E102', 'employee', 880000, '2021-03-22'],
];

const PASSWORDS = { 'admin@ifluids.com': 'Admin@123', 'manager@ifluids.com': 'Manager@123', 'employee@ifluids.com': 'Employee@123' };

export function seed() {
  const today = todayISO();
  const year = new Date().getFullYear();
  const ym = ymOf();
  const departments = ['Management', 'Human Resources', 'Process Safety', 'HSE Consulting', 'Digital Solutions', 'Finance & Accounts', 'Business Development', 'Administration'].map((name, i) => ({
    id: `dep${i + 1}`,
    name,
    code: name.split(/[ &-]+/).map((w) => w[0]).join('').toUpperCase(),
    head: { Management: 'E100', 'Human Resources': 'E101', 'Process Safety': 'E102', 'HSE Consulting': 'E104', 'Digital Solutions': 'E105', 'Finance & Accounts': 'E103', 'Business Development': 'E118', Administration: 'E101' }[name],
    description: '',
  }));
  const locations = [
    { id: 'loc1', name: 'Chennai - Head Office', address: 'Sample address, update in Settings', city: 'Chennai', state: 'Tamil Nadu', country: 'India', timezone: 'Asia/Kolkata' },
    { id: 'loc2', name: 'Mumbai Office', address: 'Sample address', city: 'Mumbai', state: 'Maharashtra', country: 'India', timezone: 'Asia/Kolkata' },
    { id: 'loc3', name: 'Client Site', address: 'Varies by project', city: '', state: '', country: 'India', timezone: 'Asia/Kolkata' },
  ];
  const shifts = [
    { id: 'sh1', name: 'General Shift', start: '09:30', end: '18:30', grace: 15, breakMinutes: 60, fullDayHours: 8, halfDayHours: 4 },
    { id: 'sh2', name: 'Early Shift', start: '07:00', end: '16:00', grace: 10, breakMinutes: 60, fullDayHours: 8, halfDayHours: 4 },
    { id: 'sh3', name: 'Site Shift', start: '08:00', end: '17:00', grace: 15, breakMinutes: 60, fullDayHours: 8, halfDayHours: 4 },
  ];
  const grades = [
    { id: 'g1', name: 'L1 - Trainee', minCtc: 250000, maxCtc: 450000 },
    { id: 'g2', name: 'L2 - Engineer', minCtc: 450000, maxCtc: 900000 },
    { id: 'g3', name: 'L3 - Senior', minCtc: 900000, maxCtc: 1500000 },
    { id: 'g4', name: 'L4 - Lead', minCtc: 1500000, maxCtc: 2500000 },
    { id: 'g5', name: 'L5 - Leadership', minCtc: 2500000, maxCtc: 6000000 },
  ];
  const gradeFor = (ctc) => (grades.find((g) => ctc >= g.minCtc && ctc < g.maxCtc) || grades[4]).id;
  const employees = PEOPLE.map((p, i) => {
    const [id, firstName, lastName, gender, designation, department, reportingTo, role, ctc, joined, email] = p;
    const doj = joined || addDays(today, 10);
    const workEmail = email || `${firstName}.${lastName}@ifluids.com`.toLowerCase();
    const dobYear = 1970 + ((i * 7) % 30);
    return {
      id,
      empNo: `IFE${id.slice(1)}`,
      firstName,
      middleName: '',
      lastName,
      displayName: '',
      gender,
      dob: `${dobYear}-${String(((i * 5) % 12) + 1).padStart(2, '0')}-${String(((i * 11) % 27) + 1).padStart(2, '0')}`,
      maritalStatus: i % 3 === 0 ? 'Single' : 'Married',
      bloodGroup: ['O+', 'A+', 'B+', 'AB+', 'O-', 'B-'][i % 6],
      nationality: 'Indian',
      physicallyChallenged: 'No',
      workEmail,
      personalEmail: `${firstName.toLowerCase()}${i + 10}@example.com`,
      mobile: `+91 98${String(40000000 + i * 1234567).slice(0, 8)}`,
      workPhone: '',
      residencePhone: '',
      skype: '',
      currentAddress: { line1: 'Sample street', line2: '', city: i % 5 === 0 ? 'Mumbai' : 'Chennai', state: i % 5 === 0 ? 'Maharashtra' : 'Tamil Nadu', country: 'India', pincode: '600001' },
      permanentAddress: { line1: 'Sample street', line2: '', city: 'Chennai', state: 'Tamil Nadu', country: 'India', pincode: '600001' },
      dateOfJoining: doj,
      designation,
      secondaryTitle: '',
      department,
      locationId: i % 5 === 0 && i > 0 ? 'loc2' : 'loc1',
      legalEntity: 'iFluids Engineering',
      businessUnit: department === 'Digital Solutions' ? 'Digital' : department === 'Management' ? 'Corporate' : 'Consulting',
      costCenter: `CC-${department.split(' ')[0].toUpperCase().slice(0, 4)}`,
      reportingTo,
      hrManager: id === 'E101' ? 'E100' : 'E101',
      workerType: id === 'E121' ? 'Intern' : 'Permanent',
      timeType: 'Full time',
      gradeId: gradeFor(ctc),
      probationEndDate: addMonths(doj.slice(0, 7), 6) + doj.slice(7),
      noticePeriodDays: role === 'employee' ? 60 : 90,
      status: id === 'E121' ? 'Pre-boarding' : id === 'E122' ? 'Notice period' : id === 'E115' || id === 'E119' ? 'Probation' : 'Active',
      shiftId: department === 'HSE Consulting' ? 'sh3' : 'sh1',
      weeklyOff: 'Saturday & Sunday',
      leavePlan: 'Standard Leave Plan',
      holidayCalendar: 'India - Tamil Nadu',
      attendanceNumber: `ATT${id.slice(1)}`,
      attendanceScheme: department === 'HSE Consulting' ? 'Web + Mobile (Remote)' : 'Web clock-in',
      expensePolicy: 'Standard Expense Policy',
      ctc,
      taxRegime: i % 4 === 0 ? 'Old' : 'New',
      bank: { bankName: ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank'][i % 4], accountNumber: `50100${String(23456789 + i * 1111)}`, ifsc: ['HDFC0001234', 'ICIC0004321', 'SBIN0000456', 'UTIB0000789'][i % 4], accountHolder: `${firstName} ${lastName}`, branch: 'Chennai' },
      pan: `ABCPD${String(1000 + i * 37).slice(0, 4)}F`,
      aadhaar: `XXXX XXXX ${String(4000 + i * 13)}`,
      passport: i % 2 ? `N${String(1234567 + i)}` : '',
      passportExpiry: i % 2 ? `${year + 4}-06-30` : '',
      voterId: '',
      drivingLicense: '',
      uan: `1009${String(12345678 + i * 97)}`,
      pfNumber: `TN/MAS/0012345/000/${String(100 + i)}`,
      esiNumber: '',
      family: i % 2 ? [{ id: `fam${i}`, name: `Sample Relative ${i}`, relation: 'Spouse', dob: '1990-01-01', phone: '', profession: '' }] : [],
      education: [{ id: `edu${i}`, degree: department === 'Finance & Accounts' ? 'B.Com' : department === 'Human Resources' ? 'MBA (HR)' : 'B.E. Chemical Engineering', branch: '', university: 'Sample University', yearOfJoining: String(dobYear + 18), yearOfCompletion: String(dobYear + 22), score: '8.1 CGPA' }],
      experience: i > 5 ? [{ id: `exp${i}`, company: 'Previous Employer', jobTitle: 'Engineer', from: `${dobYear + 22}-07-01`, to: addDays(doj, -30), description: '' }] : [],
      skills: department === 'Process Safety' ? ['HAZOP', 'LOPA', 'SIL', 'QRA'] : department === 'HSE Consulting' ? ['Fire & Gas mapping', 'Safety audit', 'ISO 45001'] : department === 'Digital Solutions' ? ['React', 'Python', 'Power BI'] : ['MS Office'],
      about: '',
      role,
      password: PASSWORDS[workEmail] || 'Welcome@123',
      color: COLORS[i % COLORS.length],
      carryForward: {},
    };
  });

  const leaveTypes = [
    { id: 'lt1', name: 'Casual Leave', code: 'CL', annualQuota: 12, accrual: 'Monthly', carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Paid', gender: 'All', color: '#5746af', description: 'For personal matters, planned in advance.' },
    { id: 'lt2', name: 'Sick Leave', code: 'SL', annualQuota: 12, accrual: 'Yearly', carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Paid', gender: 'All', color: '#0d9488', description: 'For illness; certificate needed beyond 2 days.' },
    { id: 'lt3', name: 'Earned Leave', code: 'EL', annualQuota: 15, accrual: 'Monthly', carryForward: 'Yes', maxCarryForward: 30, encashable: 'Yes', paid: 'Paid', gender: 'All', color: '#d97706', description: 'Privilege leave; carries forward up to 30 days.' },
    { id: 'lt4', name: 'Compensatory Off', code: 'CO', annualQuota: 0, accrual: 'On request', carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Paid', gender: 'All', color: '#2563eb', description: 'Granted for working on holidays or weekly offs.' },
    { id: 'lt5', name: 'Maternity Leave', code: 'ML', annualQuota: 182, accrual: 'Yearly', carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Paid', gender: 'Female', color: '#db2777', description: '26 weeks as per the Maternity Benefit Act.' },
    { id: 'lt6', name: 'Paternity Leave', code: 'PL', annualQuota: 5, accrual: 'Yearly', carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Paid', gender: 'Male', color: '#16a34a', description: '' },
    { id: 'lt7', name: 'Bereavement Leave', code: 'BL', annualQuota: 3, accrual: 'Yearly', carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Paid', gender: 'All', color: '#64748b', description: '' },
    { id: 'lt8', name: 'Loss of Pay', code: 'LOP', annualQuota: 0, unlimited: true, accrual: 'None', carryForward: 'No', maxCarryForward: 0, encashable: 'No', paid: 'Unpaid', gender: 'All', color: '#dc2626', description: 'Unpaid leave; deducted in payroll.' },
  ];

  const H = (date, name, type = 'Mandatory') => ({ id: `hol_${date}`, date, name, type, location: 'All locations' });
  const holidays = [
    H(`${year}-01-01`, "New Year's Day"),
    H(`${year}-01-14`, 'Pongal'),
    H(`${year}-01-15`, 'Thiruvalluvar Day'),
    H(`${year}-01-26`, 'Republic Day'),
    H(`${year}-03-20`, 'Ramzan (Id-ul-Fitr)', 'Optional'),
    H(`${year}-04-03`, 'Good Friday'),
    H(`${year}-04-14`, 'Tamil New Year'),
    H(`${year}-05-01`, 'May Day'),
    H(`${year}-08-15`, 'Independence Day'),
    H(`${year}-09-14`, 'Vinayakar Chathurthi'),
    H(`${year}-10-02`, 'Gandhi Jayanti'),
    H(`${year}-10-20`, 'Ayudha Pooja'),
    H(`${year}-11-09`, 'Deepavali (observed)'),
    H(`${year}-12-25`, 'Christmas'),
    H(`${year}-12-31`, "New Year's Eve", 'Optional'),
    H(`${year + 1}-01-01`, "New Year's Day"),
    H(`${year + 1}-01-14`, 'Pongal'),
  ];

  const lr = (id, empId, typeId, from, to, days, status, reason) => ({ id, empId, typeId, from, to, fromHalf: 'Full day', toHalf: 'Full day', days, status, reason, appliedOn: addDays(from, -7), notify: '', approverComment: '' });
  const leaveRequests = [
    lr('lr1', 'E106', 'lt1', addDays(today, -40), addDays(today, -40), 1, 'Approved', 'Family function'),
    lr('lr2', 'E106', 'lt2', addDays(today, -18), addDays(today, -17), 2, 'Approved', 'Fever'),
    lr('lr3', 'E106', 'lt3', addDays(today, 14), addDays(today, 16), 3, 'Pending', 'Vacation'),
    lr('lr4', 'E107', 'lt1', addDays(today, 3), addDays(today, 3), 1, 'Pending', 'Personal work'),
    lr('lr5', 'E109', 'lt3', addDays(today, -2), addDays(today, 1), 2, 'Approved', 'Travel to hometown'),
    lr('lr6', 'E113', 'lt2', today, today, 1, 'Approved', 'Not feeling well'),
    lr('lr7', 'E110', 'lt1', addDays(today, 7), addDays(today, 8), 2, 'Pending', 'Sister wedding'),
    lr('lr8', 'E117', 'lt3', addDays(today, -60), addDays(today, -56), 5, 'Approved', 'Annual vacation'),
  ];

  const attendanceRequests = [
    { id: 'ar1', empId: 'E106', type: 'Regularization', date: addDays(today, -5), clockIn: '09:30', clockOut: '18:45', reason: 'Forgot to clock in, was at client meeting', status: 'Pending', createdAt: addDays(today, -4) },
    { id: 'ar2', empId: 'E108', type: 'Work From Home', date: addDays(today, 2), to: addDays(today, 2), reason: 'Report writing', status: 'Pending', createdAt: addDays(today, -1) },
    { id: 'ar3', empId: 'E111', type: 'On Duty', date: addDays(today, -3), to: addDays(today, -1), reason: 'Site audit at client refinery', status: 'Approved', createdAt: addDays(today, -6) },
  ];

  const posts = [
    { id: 'p1', authorId: 'E101', type: 'Announcement', title: 'Deepavali celebrations', text: 'Join us at the office cafeteria for Deepavali celebrations and sweets distribution. Traditional wear encouraged!', date: addDays(today, -1) + 'T10:00:00', likes: ['E106', 'E107', 'E113'], comments: [{ id: 'c1', empId: 'E107', text: 'Looking forward to it!', date: addDays(today, -1) + 'T11:00:00' }] },
    { id: 'p2', authorId: 'E102', type: 'Praise', badge: 'Team Player', praiseTo: ['E108', 'E109'], text: 'Outstanding work facilitating the HAZOP workshop for the refinery expansion project — finished two days ahead of schedule.', date: addDays(today, -3) + 'T15:30:00', likes: ['E101', 'E100'], comments: [] },
    { id: 'p3', authorId: 'E105', type: 'Poll', text: 'Which day works best for the quarterly tech talk?', options: ['Wednesday', 'Thursday', 'Friday'], votes: { E113: 0, E114: 1, E115: 1 }, date: addDays(today, -4) + 'T09:15:00', likes: [], comments: [] },
    { id: 'p4', authorId: 'E101', type: 'Post', text: 'Reminder: please submit your investment declarations for this financial year under My Finances → Manage Tax.', date: addDays(today, -6) + 'T12:00:00', likes: ['E116'], comments: [] },
  ];

  const docs = [
    { id: 'd1', empId: '', category: 'Policies', name: 'Employee Handbook', fileName: 'employee-handbook.pdf', uploadedOn: `${year}-04-01`, description: 'Code of conduct, working hours, benefits.', ack: [] },
    { id: 'd2', empId: '', category: 'Policies', name: 'Leave Policy', fileName: 'leave-policy.pdf', uploadedOn: `${year}-04-01`, description: '', ack: [] },
    { id: 'd3', empId: '', category: 'Policies', name: 'HSE Policy', fileName: 'hse-policy.pdf', uploadedOn: `${year}-04-01`, description: 'Health, safety and environment commitments.', ack: [] },
    { id: 'd4', empId: '', category: 'Forms', name: 'Travel Request Form', fileName: 'travel-form.docx', uploadedOn: `${year}-05-10`, description: '', ack: [] },
    { id: 'd5', empId: 'E106', category: 'Identity', name: 'PAN Card', fileName: 'pan.pdf', uploadedOn: '2022-02-14', description: '', ack: [] },
    { id: 'd6', empId: 'E106', category: 'Letters', name: 'Offer Letter', fileName: 'offer-letter.pdf', uploadedOn: '2022-01-20', description: '', ack: [] },
  ];

  return {
    version: 1,
    company: {
      name: 'iFluids Engineering',
      legalName: 'iFluids Engineering',
      entityType: 'Partnership firm',
      email: 'hr@ifluids.com',
      phone: '',
      website: 'www.ifluids.com',
      address: 'Update the registered address in Settings',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      pincode: '',
      pan: '',
      tan: '',
      gstin: '',
      pfCode: '',
      esiCode: '',
      ptNumber: '',
      financialYearStart: 'April',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      loginMessage: 'Driven by knowledge, powered by teamwork—let’s make today another step forward at iFluids Engineering.',
    },
    departments,
    locations,
    shifts,
    grades,
    designations: [...new Set(PEOPLE.map((p) => p[4]))].map((title, i) => ({ id: `des${i + 1}`, title, department: PEOPLE.find((p) => p[4] === title)[5] })),
    businessUnits: ['Corporate', 'Consulting', 'Digital'].map((name, i) => ({ id: `bu${i + 1}`, name, head: ['E100', 'E102', 'E105'][i] })),
    costCenters: departments.map((d, i) => ({ id: `cc${i + 1}`, code: `CC-${d.name.split(' ')[0].toUpperCase().slice(0, 4)}`, name: d.name })),
    employees,
    attendance: [],
    attendanceRequests,
    attendanceSettings: { allowWebClockIn: true, allowRemote: true, autoClockOutHours: 14, overtimeAfterHours: 9, overtimeRate: 1.5, lateMarksForHalfDay: 3 },
    overtime: [{ id: 'ot1', empId: 'E108', date: addDays(today, -9), hours: 3, reason: 'HAZOP report deadline', status: 'Approved' }],
    leaveTypes,
    leaveRequests,
    leaveAdjustments: [],
    compOffRequests: [{ id: 'co1', empId: 'E110', workedOn: addDays(today, -12), days: 1, reason: 'Weekend shutdown audit', status: 'Pending' }],
    holidays,
    payrollSettings: { basicPct: 40, hraPct: 50, conveyance: 1600, medical: 1250, pfEnabled: true, pfCeiling: 15000, esiEnabled: true, ptEnabled: true, ptAmount: 208, lwfEnabled: true, lwfEmployee: 20, lwfEmployer: 40, payDay: 'Last working day', lockDay: 25, cycleStartDay: 26, payGroup: 'iFluids Monthly' },
    // Every month of the financial year so far has been paid (in April, the last three months).
    payrollRuns: Array.from({ length: ((Number(ym.slice(5)) + 8) % 12) || 3 }, (_, i) => i + 1).map((n) => ({ id: `run${n}`, month: addMonths(ym, -n), status: 'Paid', processedOn: `${addMonths(ym, -n + 1)}-01`, processedAt: `${addMonths(ym, -n + 1)}-01T15:57:00`, processedBy: 'E103', steps: {} })),
    payrollAdjustments: [],
    payrollHolds: [],
    payrollOverrides: [],
    payrollActivity: [],
    compPlans: [],
    budgetInputs: {},
    geoIndex: { loc1: 100, loc2: 118, loc3: 100 },
    benefitPlans: [
      { id: 'bp1', name: 'Group Health Insurance', type: 'Health insurance', provider: 'Sample Insurer', policyNumber: 'GHI-0001', coverage: 500000, employerMonthly: 950, employeeMonthly: 0, eligibility: 'All permanent employees', status: 'Active' },
      { id: 'bp2', name: 'Group Term Life', type: 'Life insurance', provider: 'Sample Insurer', policyNumber: 'GTL-0001', coverage: 1500000, employerMonthly: 300, employeeMonthly: 0, eligibility: 'All permanent employees', status: 'Active' },
      { id: 'bp3', name: 'National Pension System', type: 'Retirement', provider: 'NPS Trust', policyNumber: '', coverage: 0, employerMonthly: 0, employeeMonthly: 0, eligibility: 'Opt-in', status: 'Active' },
    ],
    benefitEnrollments: [],
    taxDeclarations: [{ id: 'td1', empId: 'E106', fy: `${year}-${String(year + 1).slice(2)}`, regime: 'Old', status: 'Submitted', items: { ppf: 50000, lic: 24000, elss: 30000, mediclaimSelf: 18000, rentMonthly: 15000, landlordName: 'Sample Landlord', landlordPan: '' }, submittedOn: addDays(today, -20) }],
    loans: [{ id: 'ln1', empId: 'E116', type: 'Salary Advance', amount: 60000, interestRate: 0, tenureMonths: 6, startMonth: addMonths(ym, -2), reason: 'Medical emergency', status: 'Active', appliedOn: addDays(today, -70) }],
    claims: [{ id: 'cl1', empId: 'E106', component: 'Fuel Reimbursement', month: addMonths(ym, -1), amount: 2400, billName: 'fuel-bills.pdf', status: 'Approved' }],
    fnf: [],
    expenses: [
      { id: 'ex1', empId: 'E106', title: 'Cab to client site', category: 'Local Conveyance', date: addDays(today, -8), amount: 860, currency: 'INR', merchant: 'Cab service', project: 'pr1', billable: 'Yes', description: 'Site visit for HAZOP', receipt: 'receipt-cab.jpg', status: 'Pending' },
      { id: 'ex2', empId: 'E106', title: 'Team lunch with client', category: 'Meals & Entertainment', date: addDays(today, -15), amount: 3200, currency: 'INR', merchant: 'Restaurant', project: 'pr1', billable: 'Yes', description: '', receipt: 'lunch.pdf', status: 'Approved' },
      { id: 'ex3', empId: 'E110', title: 'Hotel stay - audit', category: 'Accommodation', date: addDays(today, -5), amount: 7800, currency: 'INR', merchant: 'Hotel', project: 'pr2', billable: 'Yes', description: '2 nights', receipt: 'hotel.pdf', status: 'Pending' },
    ],
    expenseCategories: ['Travel - Air', 'Travel - Train', 'Local Conveyance', 'Accommodation', 'Meals & Entertainment', 'Fuel', 'Mobile & Internet', 'Training & Certification', 'Office Supplies', 'Other'],
    advances: [{ id: 'adv1', empId: 'E111', purpose: 'Site audit travel', amount: 15000, requiredBy: addDays(today, 4), status: 'Pending', settled: 'No' }],
    travel: [{ id: 'tr1', empId: 'E110', purpose: 'Safety audit at client plant', fromCity: 'Chennai', toCity: 'Jamnagar', departDate: addDays(today, 10), returnDate: addDays(today, 14), mode: 'Flight', accommodation: 'Yes', estimatedCost: 38000, project: 'pr2', status: 'Pending' }],
    goals: [
      { id: 'gl1', empId: 'E106', title: 'Complete 4 HAZOP studies as scribe', description: '', metric: 'Number', target: 4, current: 3, progress: 75, dueDate: `${year}-12-31`, status: 'On track', weight: 40, visibility: 'Public' },
      { id: 'gl2', empId: 'E106', title: 'Get certified in Functional Safety (SIL)', description: 'TÜV FS Engineer certification', metric: 'Milestone', target: 1, current: 0, progress: 30, dueDate: `${year + 1}-03-31`, status: 'Behind', weight: 30, visibility: 'Public' },
      { id: 'gl3', empId: 'E102', title: 'Grow process safety revenue by 15%', description: '', metric: 'Percent', target: 15, current: 11, progress: 73, dueDate: `${year + 1}-03-31`, status: 'On track', weight: 50, visibility: 'Public' },
    ],
    feedback: [{ id: 'fb1', fromId: 'E107', toId: 'E106', type: 'Feedback', text: 'Your LOPA worksheets were very clear. Keep documenting assumptions like that.', visibility: 'Shared with manager', date: addDays(today, -10) }],
    reviewCycles: [{ id: 'rc1', name: `Annual Review ${year - 1}-${String(year).slice(2)}`, from: `${year - 1}-04-01`, to: `${year}-03-31`, status: 'Closed' }, { id: 'rc2', name: `Mid-year Review ${year}`, from: `${year}-04-01`, to: `${year}-09-30`, status: 'In progress' }],
    reviews: [
      { id: 'rv1', cycleId: 'rc2', empId: 'E106', reviewerId: 'E102', selfRating: 4, selfComments: 'Delivered all assigned studies on time.', managerRating: 0, managerComments: '', status: 'Manager review pending' },
      { id: 'rv2', cycleId: 'rc1', empId: 'E106', reviewerId: 'E102', selfRating: 4, selfComments: '', managerRating: 4, managerComments: 'Strong technical growth.', status: 'Completed' },
    ],
    oneOnOnes: [{ id: 'oo1', managerId: 'E102', empId: 'E106', date: addDays(today, 2), time: '16:00', agenda: 'Certification plan, project allocation', notes: '', status: 'Scheduled' }],
    pips: [],
    competencies: [
      { id: 'cp1', name: 'Technical expertise', type: 'Functional', description: 'Applies process safety methods correctly.' },
      { id: 'cp2', name: 'Communication', type: 'Behavioural', description: 'Writes clear reports and facilitates meetings.' },
      { id: 'cp3', name: 'Ownership', type: 'Behavioural', description: 'Takes responsibility for outcomes.' },
      { id: 'cp4', name: 'Client focus', type: 'Behavioural', description: '' },
    ],
    promotions: [],
    jobs: [
      { id: 'jb1', title: 'Senior Process Safety Engineer', department: 'Process Safety', locationId: 'loc1', employmentType: 'Full time', experience: '5-8 years', openings: 2, salaryRange: '12-18 LPA', hiringManager: 'E102', status: 'Open', postedOn: addDays(today, -21), description: 'Lead HAZOP/LOPA studies and mentor engineers.' },
      { id: 'jb2', title: 'Full Stack Developer', department: 'Digital Solutions', locationId: 'loc1', employmentType: 'Full time', experience: '2-4 years', openings: 1, salaryRange: '8-12 LPA', hiringManager: 'E105', status: 'Open', postedOn: addDays(today, -9), description: 'Build internal safety software tools.' },
      { id: 'jb3', title: 'HSE Intern', department: 'HSE Consulting', locationId: 'loc3', employmentType: 'Internship', experience: 'Fresher', openings: 3, salaryRange: 'Stipend', hiringManager: 'E104', status: 'On hold', postedOn: addDays(today, -40), description: '' },
    ],
    candidates: [
      { id: 'cd1', jobId: 'jb1', name: 'Ravi Shankar', email: 'ravi@example.com', phone: '+91 90000 00001', source: 'Job portal', experience: 6, currentCtc: 1100000, expectedCtc: 1500000, noticePeriod: '60 days', stage: 'Interview', rating: 4, resume: 'ravi-cv.pdf', notes: 'Strong LOPA experience', appliedOn: addDays(today, -15) },
      { id: 'cd2', jobId: 'jb1', name: 'Nisha Verma', email: 'nisha@example.com', phone: '+91 90000 00002', source: 'Referral', experience: 7, currentCtc: 1300000, expectedCtc: 1700000, noticePeriod: '90 days', stage: 'Offer', rating: 5, resume: 'nisha-cv.pdf', notes: '', appliedOn: addDays(today, -19) },
      { id: 'cd3', jobId: 'jb2', name: 'Akash Jain', email: 'akash@example.com', phone: '+91 90000 00003', source: 'Careers page', experience: 3, currentCtc: 700000, expectedCtc: 1000000, noticePeriod: '30 days', stage: 'Screening', rating: 3, resume: 'akash-cv.pdf', notes: '', appliedOn: addDays(today, -6) },
      { id: 'cd4', jobId: 'jb2', name: 'Fathima Begum', email: 'fathima@example.com', phone: '+91 90000 00004', source: 'LinkedIn', experience: 2, currentCtc: 600000, expectedCtc: 850000, noticePeriod: 'Immediate', stage: 'Applied', rating: 0, resume: 'fathima-cv.pdf', notes: '', appliedOn: addDays(today, -2) },
      { id: 'cd5', jobId: 'jb1', name: 'Tarun Kapoor', email: 'tarun@example.com', phone: '+91 90000 00005', source: 'Consultant', experience: 5, currentCtc: 1000000, expectedCtc: 1400000, noticePeriod: '60 days', stage: 'Rejected', rating: 2, resume: 'tarun-cv.pdf', notes: 'Limited SIL exposure', appliedOn: addDays(today, -25) },
    ],
    interviews: [{ id: 'iv1', candidateId: 'cd1', round: 'Technical round 1', date: addDays(today, 1), time: '11:00', interviewers: 'E108', mode: 'Video call', feedback: '', result: 'Scheduled' }],
    offers: [{ id: 'of1', candidateId: 'cd2', jobId: 'jb1', ctc: 1650000, joiningDate: addDays(today, 45), validTill: addDays(today, 7), status: 'Sent' }],
    onboardingTasks: [
      { id: 'ob1', empId: 'E121', task: 'Collect signed offer letter', owner: 'E117', dueDate: addDays(today, -2), stage: 'Pre-boarding', done: true },
      { id: 'ob2', empId: 'E121', task: 'Collect ID, address and education documents', owner: 'E117', dueDate: addDays(today, 3), stage: 'Pre-boarding', done: false },
      { id: 'ob3', empId: 'E121', task: 'Issue laptop and safety shoes', owner: 'E120', dueDate: addDays(today, 10), stage: 'Day 1', done: false },
      { id: 'ob4', empId: 'E121', task: 'Create email account and HRMS login', owner: 'E113', dueDate: addDays(today, 9), stage: 'Day 1', done: false },
      { id: 'ob5', empId: 'E121', task: 'HSE induction training', owner: 'E104', dueDate: addDays(today, 12), stage: 'Week 1', done: false },
    ],
    exits: [{ id: 'ext1', empId: 'E122', exitType: 'Resignation', resignationDate: addDays(today, -25), lastWorkingDay: addDays(today, 35), reason: 'Higher studies', notes: '', status: 'Approved', checklist: { handover: false, assets: false, accessRevoked: false, exitInterview: false, noDues: false } }],
    projects: [
      { id: 'pr1', name: 'Refinery Expansion HAZOP', code: 'PS-2401', clientId: 'cl1', manager: 'E102', startDate: addDays(today, -90), endDate: addDays(today, 60), billing: 'Fixed price', budgetHours: 1200, status: 'Active', members: ['E106', 'E107', 'E108', 'E109'] },
      { id: 'pr2', name: 'Terminal Fire & Gas Mapping', code: 'HSE-2407', clientId: 'cl2', manager: 'E104', startDate: addDays(today, -45), endDate: addDays(today, 30), billing: 'Time & material', budgetHours: 600, status: 'Active', members: ['E110', 'E111', 'E112'] },
      { id: 'pr3', name: 'Safety Dashboard Platform', code: 'DS-2402', clientId: '', manager: 'E105', startDate: addDays(today, -120), endDate: addDays(today, 120), billing: 'Internal', budgetHours: 2000, status: 'Active', members: ['E113', 'E114', 'E115'] },
      { id: 'pr4', name: 'Internal - Training & Admin', code: 'INT-001', clientId: '', manager: 'E101', startDate: `${year}-01-01`, endDate: `${year}-12-31`, billing: 'Non-billable', budgetHours: 0, status: 'Active', members: [] },
    ],
    clients: [
      { id: 'cl1', name: 'Sample Refining Co.', contactPerson: 'Client contact', email: 'contact@example.com', phone: '', country: 'India', industry: 'Oil & Gas' },
      { id: 'cl2', name: 'Sample Terminals Ltd.', contactPerson: 'Client contact', email: 'contact2@example.com', phone: '', country: 'India', industry: 'Storage terminals' },
    ],
    timesheets: [],
    posts,
    tickets: [
      { id: 'tk1', empId: 'E106', category: 'Payroll', subject: 'Form 16 for last year', description: 'Please share my Form 16 for the previous financial year.', priority: 'Medium', status: 'Open', assignee: 'E103', createdAt: addDays(today, -2) + 'T10:00:00', comments: [] },
      { id: 'tk2', empId: 'E113', category: 'IT', subject: 'VPN access', description: 'Need VPN access for remote work.', priority: 'High', status: 'In progress', assignee: 'E105', createdAt: addDays(today, -1) + 'T09:00:00', comments: [{ id: 'tc1', empId: 'E105', text: 'Request raised with IT vendor.', date: addDays(today, -1) + 'T12:00:00' }] },
    ],
    ticketCategories: ['HR', 'Payroll', 'IT', 'Admin & Facilities', 'Travel', 'Other'],
    assets: [
      { id: 'as1', type: 'Laptop', name: 'Dell Latitude 5440', serialNo: 'DL5440-0001', purchaseDate: '2023-04-12', cost: 82000, condition: 'Good', assignedTo: 'E106', assignedOn: '2023-04-15', notes: '' },
      { id: 'as2', type: 'Laptop', name: 'Lenovo ThinkPad E14', serialNo: 'TPE14-0007', purchaseDate: '2022-08-01', cost: 68000, condition: 'Good', assignedTo: 'E113', assignedOn: '2022-08-01', notes: '' },
      { id: 'as3', type: 'Mobile', name: 'Android phone', serialNo: 'MOB-0012', purchaseDate: '2024-01-10', cost: 22000, condition: 'Good', assignedTo: 'E110', assignedOn: '2024-01-12', notes: 'For site work' },
      { id: 'as4', type: 'Safety gear', name: 'Gas detector', serialNo: 'GD-0003', purchaseDate: '2021-05-20', cost: 45000, condition: 'Needs calibration', assignedTo: '', assignedOn: '', notes: '' },
      { id: 'as5', type: 'Laptop', name: 'Dell Latitude 3540', serialNo: 'DL3540-0011', purchaseDate: addDays(today, -20), cost: 61000, condition: 'New', assignedTo: '', assignedOn: '', notes: 'Reserved for new joinee' },
    ],
    assetTypes: ['Laptop', 'Desktop', 'Monitor', 'Mobile', 'SIM card', 'Access card', 'Safety gear', 'Vehicle', 'Other'],
    documents: docs,
    courses: [
      { id: 'cr1', title: 'HSE Induction', category: 'Mandatory', duration: '2 hours', description: 'Site safety rules, PPE and emergency response.', mandatory: 'Yes', enrolled: ['E106', 'E121', 'E112'], completed: ['E106'] },
      { id: 'cr2', title: 'Introduction to HAZOP', category: 'Technical', duration: '6 hours', description: 'Guidewords, deviations and recording.', mandatory: 'No', enrolled: ['E109', 'E121'], completed: [] },
      { id: 'cr3', title: 'POSH Awareness', category: 'Mandatory', duration: '1 hour', description: 'Prevention of sexual harassment at the workplace.', mandatory: 'Yes', enrolled: [], completed: [] },
    ],
    notifications: [],
    lastSeed: iso(new Date()),
  };
}
