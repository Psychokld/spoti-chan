import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, KeyRound, LoaderCircle, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { accountRequest } from './account-api.js';
import './account.css';

function verificationFromHash() {
  if (!window.location.hash.startsWith('#/verify?')) return '';
  return new URLSearchParams(window.location.hash.split('?')[1]).get('token') || '';
}

function Field({ label, hint, ...props }) {
  const id = useId();
  return <div className="account-field"><label htmlFor={id}>{label}</label>
    <input id={id} aria-describedby={hint ? `${id}-help` : undefined} {...props} />
    {hint && <span className="account-field-hint" id={`${id}-help`}>{hint}</span>}
  </div>;
}

function Submit({ busy, children, secondary = false }) {
  return <button type="submit" className={`button ${secondary ? 'account-button-secondary' : 'button-primary'}`} disabled={busy}>
    {busy ? <LoaderCircle size={17} className="animate-spin" /> : null}{children}{!busy && !secondary && <ArrowRight size={16} />}
  </button>;
}

export default function Account({ onSessionChange }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState('login');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState(verificationFromHash);
  const [challenge, setChallenge] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [registration, setRegistration] = useState({ displayName: '', email: '', password: '' });
  const [resendEmail, setResendEmail] = useState('');
  const [showResend, setShowResend] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordCode, setPasswordCode] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');
  const [securityCode, setSecurityCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const callback = useRef(onSessionChange);
  callback.current = onSessionChange;

  function updateSession(value) {
    setUser(value);
    setDisplayName(value?.displayName || '');
    if (!value) {
      setSetup(null); setRecoveryCodes([]); setSecurityPassword(''); setSecurityCode('');
      setNewEmail(''); setEmailPassword(''); setEmailCode('');
      setOldPassword(''); setNewPassword(''); setPasswordCode('');
      setDeleteOpen(false); setDeleteConfirmed(false); setDeletePassword(''); setDeleteCode('');
    }
    callback.current?.(value);
  }

  async function loadSession(signal) {
    try {
      const data = await accountRequest('/api/users/me', { signal });
      updateSession(data.user);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error.status === 401) updateSession(null);
      else setError(error.message);
    } finally { if (!signal?.aborted) setChecking(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadSession(controller.signal);
    const handleHash = () => setToken(verificationFromHash());
    window.addEventListener('hashchange', handleHash);
    return () => { controller.abort(); window.removeEventListener('hashchange', handleHash); };
  }, []);

  async function run(action, work) {
    if (busy) return;
    setBusy(action); setError(''); setNotice('');
    try { await work(); }
    catch (error) {
      if (error.status === 401 && user) updateSession(null);
      if (action === 'email' && error.status === 503) await loadSession();
      setError(error.message);
    }
    finally { setBusy(''); }
  }

  function clearVerification() {
    setToken('');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/account`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  function switchTab(next) {
    setTab(next); setChallenge(''); setOtp(''); setError(''); setNotice('');
    setLoginPassword(''); setShowResend(false);
  }

  const isBusy = Boolean(busy);
  const codeField = (value, onChange) => <Field label="Код 2FA или резервный код" value={value}
    onChange={event => onChange(event.target.value)} autoComplete="one-time-code" required maxLength={80}
    hint="Используй новый код из приложения-аутентификатора либо один резервный код." disabled={isBusy} />;

  return <div className="account-page">
    <div className="page-heading illustrated-heading account-heading">
      <img className="section-portrait" src="/assets/chan-violet.png" alt="" />
      <span className="eyebrow"><ShieldCheck size={14} /> ТВОЯ УЧЁТНАЯ ЗАПИСЬ</span>
      <h1>Твой профиль.<br /><span className="text-accent">Твоя частота.</span></h1>
      <p>Вход, подтверждение почты и дополнительная защита аккаунта.</p>
    </div>

    {notice && <div className="account-notice" role="status"><Check size={18} /><span>{notice}</span></div>}
    {error && <div className="error-banner account-error" role="alert">{error}</div>}

    {token && <section className="account-panel account-verify" aria-labelledby="verify-title">
      <span className="account-panel-icon"><Mail size={22} /></span>
      <h2 id="verify-title">Подтвердить почту</h2>
      <p>Активируй аккаунт по ссылке из письма. После подтверждения можно войти с паролем.</p>
      <div className="account-actions"><button className="button button-primary" disabled={isBusy} onClick={() => run('verify', async () => {
        const data = await accountRequest('/api/auth/verify-email', { method: 'POST', body: { token } });
        clearVerification(); setTab('login'); setNotice(data.message || 'Почта подтверждена. Теперь можно войти.');
        await loadSession();
      })}>{busy === 'verify' ? <LoaderCircle size={17} className="animate-spin" /> : <Mail size={17} />}Подтвердить почту</button>
        <button className="text-button" disabled={isBusy} onClick={clearVerification}>Вернуться к аккаунту</button></div>
    </section>}

    {checking ? <div className="loading-state" role="status"><LoaderCircle className="animate-spin" size={24} />Проверяем вход…</div>
      : !user ? <section className="account-panel account-auth" aria-label="Вход и регистрация">
        <div className="account-tabs" aria-label="Выбор формы">
          <button type="button" className={tab === 'login' ? 'selected' : ''} aria-pressed={tab === 'login'} disabled={isBusy} onClick={() => switchTab('login')}>Войти</button>
          <button type="button" className={tab === 'register' ? 'selected' : ''} aria-pressed={tab === 'register'} disabled={isBusy} onClick={() => switchTab('register')}>Регистрация</button>
        </div>
        {tab === 'login' ? challenge ? <form onSubmit={event => { event.preventDefault(); run('otp-login', async () => {
          const data = await accountRequest('/api/auth/2fa/login', { method: 'POST', body: { challengeToken: challenge, code: otp.trim() } });
          setChallenge(''); setOtp(''); updateSession(data.user); setNotice('Ты вошёл в аккаунт.');
        }); }}>
          <h2><KeyRound size={20} /> Второй шаг</h2><p>Пароль принят. Подтверди вход кодом из приложения-аутентификатора.</p>
          {codeField(otp, setOtp)}<Submit busy={isBusy}>Подтвердить вход</Submit>
          <button className="text-button account-back" type="button" disabled={isBusy} onClick={() => { setChallenge(''); setOtp(''); setError(''); }}>Вернуться к паролю</button>
        </form> : <form onSubmit={event => { event.preventDefault(); run('login', async () => {
          const data = await accountRequest('/api/auth/login', { method: 'POST', body: { email: loginEmail.trim(), password: loginPassword } });
          setLoginPassword('');
          if (data.requiresTwoFactor) { setChallenge(data.challengeToken); setOtp(''); }
          else { updateSession(data.user); setNotice('Ты вошёл в аккаунт.'); }
        }); }}>
          <h2>С возвращением</h2><p>Используй адрес подтверждённой почты и свой пароль.</p>
          <Field label="Электронная почта" type="email" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} autoComplete="email" required maxLength={254} disabled={isBusy} />
          <Field label="Пароль" type="password" value={loginPassword} onChange={event => setLoginPassword(event.target.value)} autoComplete="current-password" required maxLength={128} disabled={isBusy} />
          <Submit busy={isBusy}>Войти</Submit>
        </form> : <form onSubmit={event => { event.preventDefault(); run('register', async () => {
          const data = await accountRequest('/api/auth/register', { method: 'POST', body: { ...registration, email: registration.email.trim(), displayName: registration.displayName.trim() } });
          setResendEmail(registration.email); setLoginEmail(registration.email); setRegistration({ displayName: '', email: '', password: '' });
          setTab('login'); setNotice(data.message || 'Проверь почту и открой ссылку для активации аккаунта.');
        }); }}>
          <h2>Настройся на свою волну</h2><p>После регистрации нужно подтвердить адрес электронной почты.</p>
          <Field label="Имя" value={registration.displayName} onChange={event => setRegistration(value => ({ ...value, displayName: event.target.value }))} autoComplete="nickname" required minLength={1} maxLength={80} disabled={isBusy} />
          <Field label="Электронная почта" type="email" value={registration.email} onChange={event => setRegistration(value => ({ ...value, email: event.target.value }))} autoComplete="email" required maxLength={254} disabled={isBusy} />
          <Field label="Пароль" type="password" value={registration.password} onChange={event => setRegistration(value => ({ ...value, password: event.target.value }))} autoComplete="new-password" required minLength={12} maxLength={128} hint="От 12 до 128 символов. Используй уникальный пароль." disabled={isBusy} />
          <Submit busy={isBusy}>Создать аккаунт</Submit>
        </form>}
        {!challenge && <div className="account-resend">
          <button type="button" className="text-button" disabled={isBusy} onClick={() => setShowResend(value => !value)}>{showResend ? 'Скрыть повторную отправку' : 'Письмо активации не пришло?'}</button>
          {showResend && <form onSubmit={event => { event.preventDefault(); run('resend', async () => {
            const data = await accountRequest('/api/auth/resend-verification', { method: 'POST', body: { email: resendEmail.trim() } });
            setNotice(data.message || 'Если аккаунт ожидает активации, ссылка отправлена на почту.');
          }); }}>
            <Field label="Почта для повторной отправки" type="email" value={resendEmail} onChange={event => setResendEmail(event.target.value)} autoComplete="email" required maxLength={254} disabled={isBusy} />
            <Submit secondary busy={isBusy}>Отправить ссылку снова</Submit>
          </form>}
        </div>}
      </section>
      : <>
        <section className="account-summary" aria-label="Текущий аккаунт"><div className="account-avatar"><UserRound size={26} /></div>
          <div className="account-summary-copy"><h2>{user.displayName}</h2><p>{user.email}</p><span><Check size={13} /> Почта подтверждена</span></div>
          <button className="button account-button-secondary" disabled={isBusy} onClick={() => run('logout', async () => {
            await accountRequest('/api/auth/logout', { method: 'POST', body: {} });
            updateSession(null); setSetup(null); setRecoveryCodes([]); setNotice('Ты вышел из аккаунта.');
          })}><LogOut size={16} />Выйти</button>
        </section>
        <div className="account-settings-grid">
          <section className="account-panel" aria-labelledby="profile-title"><h2 id="profile-title"><UserRound size={20} /> Профиль</h2>
            <form onSubmit={event => { event.preventDefault(); run('name', async () => {
              const data = await accountRequest('/api/users/me', { method: 'PATCH', body: { displayName: displayName.trim() } });
              updateSession(data.user); setNotice('Имя обновлено.');
            }); }}>
              <Field label="Имя в профиле" value={displayName} onChange={event => setDisplayName(event.target.value)} required minLength={1} maxLength={80} autoComplete="nickname" disabled={isBusy} />
              <Submit busy={isBusy}>Сохранить имя</Submit>
            </form>
            <details className="account-details"><summary>Изменить почту</summary><p>Новый адрес потребуется подтвердить. После смены почты нужно войти снова.</p>
              <form onSubmit={event => { event.preventDefault(); run('email', async () => {
                const data = await accountRequest('/api/users/me', { method: 'PATCH', body: { email: newEmail.trim(), currentPassword: emailPassword, ...(user.twoFactorEnabled ? { code: emailCode.trim() } : {}) } });
                setNewEmail(''); setEmailPassword(''); setEmailCode('');
                updateSession(data.requiresVerification ? null : data.user);
                setNotice(data.message || 'Подтверди новый адрес по ссылке из письма, затем войди снова.');
              }); }}>
                <Field label="Новый адрес почты" type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" required maxLength={254} disabled={isBusy} />
                <Field label="Текущий пароль для смены почты" type="password" value={emailPassword} onChange={event => setEmailPassword(event.target.value)} autoComplete="current-password" required maxLength={128} disabled={isBusy} />
                {user.twoFactorEnabled && codeField(emailCode, setEmailCode)}<Submit busy={isBusy}>Изменить почту</Submit>
              </form>
            </details>
            <details className="account-details"><summary>Изменить пароль</summary><p>Другие сеансы будут завершены. На этом устройстве вход сохранится.</p>
              <form onSubmit={event => { event.preventDefault(); run('password', async () => {
                await accountRequest('/api/users/me', { method: 'PATCH', body: { newPassword, currentPassword: oldPassword, ...(user.twoFactorEnabled ? { code: passwordCode.trim() } : {}) } });
                setOldPassword(''); setNewPassword(''); setPasswordCode(''); await loadSession();
                setNotice('Пароль изменён. Другие сеансы завершены.');
              }); }}>
                <Field label="Текущий пароль" type="password" value={oldPassword} onChange={event => setOldPassword(event.target.value)} autoComplete="current-password" required maxLength={128} disabled={isBusy} />
                <Field label="Новый пароль" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={128} hint="От 12 до 128 символов." disabled={isBusy} />
                {user.twoFactorEnabled && codeField(passwordCode, setPasswordCode)}<Submit busy={isBusy}>Изменить пароль</Submit>
              </form>
            </details>
          </section>

          <section className="account-panel" aria-labelledby="security-title"><h2 id="security-title"><ShieldCheck size={20} /> Двухфакторная защита</h2>
            <p>Дополнительный код из приложения-аутентификатора при входе. Подойдёт Google Authenticator, Microsoft Authenticator или другое TOTP-приложение.</p>
            <span className={`account-security-status ${user.twoFactorEnabled ? 'enabled' : ''}`}><ShieldCheck size={14} />{user.twoFactorEnabled ? '2FA включена' : '2FA пока выключена'}</span>
            {!user.twoFactorEnabled && !setup && <form onSubmit={event => { event.preventDefault(); run('setup', async () => {
              const data = await accountRequest('/api/auth/2fa/setup', { method: 'POST', body: { currentPassword: securityPassword } });
              setSetup(data); setSecurityPassword(''); setSecurityCode(''); setRecoveryCodes([]);
            }); }}>
              <Field label="Текущий пароль для настройки 2FA" type="password" value={securityPassword} onChange={event => setSecurityPassword(event.target.value)} autoComplete="current-password" required maxLength={128} disabled={isBusy} />
              <Submit busy={isBusy}>Настроить 2FA</Submit>
            </form>}
            {!user.twoFactorEnabled && setup && <div className="account-two-factor-setup">
              <p>Отсканируй QR-код в приложении-аутентификаторе или введи ключ вручную. Не передавай этот ключ другим.</p>
              {setup.qrCodeDataUrl && <img className="account-qr" src={setup.qrCodeDataUrl} alt="QR-код для добавления Spoti-Chan в приложение-аутентификатор" width="200" height="200" />}
              <span className="account-key-label">Ключ для ручного ввода</span><code className="account-secret">{setup.secret}</code>
              <form onSubmit={event => { event.preventDefault(); run('enable', async () => {
                const data = await accountRequest('/api/auth/2fa/enable', { method: 'POST', body: { code: securityCode.trim() } });
                updateSession(data.user); setSetup(null); setSecurityCode(''); setRecoveryCodes(data.recoveryCodes || []);
                setNotice('2FA включена. Сохрани резервные коды: они понадобятся при потере доступа к приложению.');
              }); }}>
                <Field label="Код из приложения" value={securityCode} onChange={event => setSecurityCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required pattern="[0-9]{6}" maxLength={6} disabled={isBusy} />
                <Submit busy={isBusy}>Включить 2FA</Submit>
                <button type="button" className="text-button account-back" disabled={isBusy} onClick={() => { setSetup(null); setSecurityCode(''); }}>Отменить настройку</button>
              </form>
            </div>}
            {user.twoFactorEnabled && <form onSubmit={event => { event.preventDefault(); run('disable', async () => {
              const data = await accountRequest('/api/auth/2fa/disable', { method: 'POST', body: { currentPassword: securityPassword, code: securityCode.trim() } });
              updateSession(data.user); setSecurityPassword(''); setSecurityCode(''); setRecoveryCodes([]); setNotice('2FA выключена.');
            }); }}>
              <Field label="Пароль для управления 2FA" type="password" value={securityPassword} onChange={event => setSecurityPassword(event.target.value)} autoComplete="current-password" required maxLength={128} disabled={isBusy} />
              {codeField(securityCode, setSecurityCode)}
              <p className="account-fine-print">Код из приложения можно использовать только один раз. После предыдущего действия дождись следующего кода.</p>
              <div className="account-actions"><Submit secondary busy={isBusy}>Выключить 2FA</Submit>
                <button type="button" className="text-button" disabled={isBusy || !securityPassword || !securityCode.trim()} onClick={() => run('recovery', async () => {
                  const data = await accountRequest('/api/auth/2fa/recovery-codes', { method: 'POST', body: { currentPassword: securityPassword, code: securityCode.trim() } });
                  setRecoveryCodes(data.recoveryCodes || []); setSecurityPassword(''); setSecurityCode(''); setNotice('Созданы новые резервные коды. Предыдущие больше не действуют.');
                })}>Новые резервные коды</button></div>
            </form>}
            {recoveryCodes.length > 0 && <div className="account-recovery" role="status"><h3>Резервные коды</h3><p>Каждый код используется один раз. Сохрани их в надёжном месте до ухода с этой страницы.</p>
              <ul>{recoveryCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
              <button type="button" className="text-button" onClick={() => run('copy', async () => {
                if (!navigator.clipboard) throw new Error('Копирование недоступно. Сохрани коды вручную.');
                await navigator.clipboard.writeText(recoveryCodes.join('\n')); setNotice('Резервные коды скопированы.');
              })}><Copy size={14} />Скопировать коды</button>
              <button type="button" className="text-button account-back" onClick={() => setRecoveryCodes([])}>Я сохранил коды — скрыть</button>
            </div>}
          </section>
        </div>
        <section className="account-panel account-danger" aria-labelledby="delete-title"><h2 id="delete-title">Удалить аккаунт</h2><p>Профиль и его серверные данные будут удалены. Восстановить аккаунт после удаления нельзя.</p>
          {!deleteOpen ? <button className="button account-button-danger" disabled={isBusy} onClick={() => setDeleteOpen(true)}>Перейти к удалению</button>
            : <form onSubmit={event => { event.preventDefault(); if (!deleteConfirmed) return; run('delete', async () => {
              const data = await accountRequest('/api/users/me', { method: 'DELETE', body: { currentPassword: deletePassword, ...(user.twoFactorEnabled ? { code: deleteCode.trim() } : {}) } });
              updateSession(null); setDeleteOpen(false); setDeletePassword(''); setDeleteCode(''); setDeleteConfirmed(false); setSetup(null); setRecoveryCodes([]);
              setNotice(data.message || 'Аккаунт удалён.');
            }); }}>
              <Field label="Пароль для удаления аккаунта" type="password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} autoComplete="current-password" required maxLength={128} disabled={isBusy} />
              {user.twoFactorEnabled && codeField(deleteCode, setDeleteCode)}
              <label className="account-checkbox"><input type="checkbox" required checked={deleteConfirmed} onChange={event => setDeleteConfirmed(event.target.checked)} disabled={isBusy} />Я понимаю, что аккаунт будет удалён без восстановления.</label>
              <div className="account-actions"><button type="submit" className="button account-button-danger" disabled={isBusy || !deleteConfirmed}>{busy === 'delete' && <LoaderCircle size={16} className="animate-spin" />}Удалить навсегда</button>
                <button type="button" className="text-button" disabled={isBusy} onClick={() => { setDeleteOpen(false); setDeletePassword(''); setDeleteCode(''); setDeleteConfirmed(false); }}>Отмена</button></div>
            </form>}
        </section>
      </>}
  </div>;
}
