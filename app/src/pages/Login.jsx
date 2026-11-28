import { useEffect, useState } from 'react';
import { getDB, setSession, addItem } from '../store.js';
import { Modal, toast } from '../ui.jsx';
import photo from '../assets/login-photo.webp';
import hiveLogo from '../assets/ife-hive-logo.svg';
import hiveMark from '../assets/ife-hive-mark.svg';
import companyLogo from '../assets/ifluids-logo.png';
import '../login.css';

const svgUrl = (s) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

// Neutral store badges and footer mark, drawn as pictures like the original's.
const BADGE = (glyph, small, big) =>
  svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="115" height="34" viewBox="0 0 115 34"><rect x="0.5" y="0.5" width="114" height="33" rx="5" fill="#000" stroke="#6d7380"/>${glyph}<text x="36" y="12" fill="#fff" font-size="6.4" font-family="Arial, sans-serif">${small}</text><text x="35.5" y="26" fill="#fff" font-size="13.5" font-weight="600" font-family="Arial, sans-serif">${big}</text></svg>`,
  );
const APP_STORE = BADGE('<rect x="12" y="7" width="12" height="20" rx="2.5" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="18" cy="23.5" r="1" fill="#fff"/>', 'Download on the', 'App Store');
const PLAY_STORE = BADGE('<path d="M12 7.5v19l14-9.5z" fill="#fff"/>', 'GET IT ON', 'Google Play');

// Input with its name shown inside the box; it slides up once the box is used.
function LgField({ id, label, className = '', ...rest }) {
  return (
    <div className={`lg-field ${className}`}>
      <input className="lg-input" id={id} placeholder=" " {...rest} />
      <label htmlFor={id} className="lg-label">
        {label}
      </label>
    </div>
  );
}

export default function Login({ mode = 'login' }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [legal, setLegal] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const forgot = mode === 'forgot';

  useEffect(() => {
    setError('');
    setSent(false);
  }, [mode]);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!form.email.trim()) return setError('Please enter your email.');
    if (!forgot && !form.password) return setError('Please enter your password.');
    const db = getDB();
    const key = form.email.trim().toLowerCase();
    const emp = db.employees.find((x) => x.workEmail.toLowerCase() === key || x.empNo.toLowerCase() === key);
    if (forgot) {
      if (emp) {
        addItem('tickets', {
          empId: emp.id,
          category: 'HR',
          subject: 'Password reset request',
          description: `Password reset requested from the login page for ${emp.workEmail}.`,
          priority: 'High',
          status: 'Open',
          assignee: db.employees.find((x) => x.role === 'admin' && x.department === 'Human Resources')?.id || '',
          createdAt: new Date().toISOString(),
          comments: [],
        });
      }
      setSent(true);
      return;
    }
    if (!emp || emp.password !== form.password) return setError('Invalid email or password.');
    if (emp.status === 'Exited') return setError('This account has been deactivated. Please contact HR.');
    setSession(emp.id);
    window.location.hash = '#/home';
  };

  const company = getDB().company;

  return (
    <div className="lg">
      <div className="lg-art" aria-hidden="true">
        <img src={photo} alt="" />
        <div className="lg-art-caption">
          <span>iFe Hive</span>
          <strong>People, pay and time, together.</strong>
        </div>
      </div>
      <main className="lg-panel">
        <img className="lg-logo" src={hiveLogo} alt="iFe Hive" width="150" height="50" />
        <h1 className="lg-title">{forgot ? 'Forgot password' : 'Login to iFe Hive'}</h1>
        <p className="lg-sub">{forgot ? 'Enter your work email and HR will reset it.' : 'Welcome back. Sign in with your work email.'}</p>
        {sent ? (
          <div className="lg-sent">
            <p>If an account exists for that email, a password reset request has been sent to HR. They will share a new password with you.</p>
            <p className="lg-forgot">
              <a href="#/">Back to login</a>
            </p>
          </div>
        ) : (
          <form className="lg-form" onSubmit={submit} noValidate>
            {error && (
              <p className="lg-error" role="alert">
                {error}
              </p>
            )}
            <LgField id="email" label="Email" name="Email" type="text" autoComplete="username" value={form.email} onChange={set('email')} />
            {!forgot && <LgField id="password" label="Password" name="Password" type="password" autoComplete="current-password" value={form.password} onChange={set('password')} />}
            <button type="submit" className="lg-btn">
              {forgot ? 'Send reset request' : 'Login'}
            </button>
            <p className="lg-forgot">{forgot ? <a href="#/">Back to login</a> : <a href="#/forgot-password">Forgot password ?</a>}</p>
          </form>
        )}
        <p className="lg-quote">{company.loginMessage}</p>
        <div className="lg-footer">
          <div className="lg-stores">
            <a href="#/" onClick={(e) => (e.preventDefault(), toast('The mobile app is not part of this web version yet.', 'info'))}>
              <img src={APP_STORE} alt="Download on the App Store" width="115" height="34" />
            </a>
            <a href="#/" onClick={(e) => (e.preventDefault(), toast('The mobile app is not part of this web version yet.', 'info'))}>
              <img src={PLAY_STORE} alt="Get it on Google Play" width="115" height="34" />
            </a>
          </div>
          <div className="lg-legal">
            <img className="lg-mark" src={companyLogo} alt="iFluids Engineering" width="79" height="28" />
            <p>
              By logging in, you agree to the{' '}
              <a href="#/" onClick={(e) => (e.preventDefault(), setLegal('terms'))}>
                Terms of Use
              </a>{' '}
              and{' '}
              <a href="#/" onClick={(e) => (e.preventDefault(), setLegal('privacy'))}>
                Privacy Policy
              </a>
            </p>
          </div>
        </div>
      </main>
      {legal && (
        <Modal title={legal === 'terms' ? 'Terms of Use' : 'Privacy Policy'} onClose={() => setLegal(null)}>
          <p className="muted">
            {legal === 'terms'
              ? `This HR system is provided by ${company.name} for its employees. Use it only for official HR purposes and keep your password private.`
              : `${company.name} stores the personal and employment details in this system only for HR, payroll and statutory purposes. Ask HR to correct or remove your data.`}
          </p>
        </Modal>
      )}
    </div>
  );
}
