'use client';

export default function LogoutButton() {
  function logout() {
    try {
      window.sessionStorage.clear();
      window.localStorage.removeItem('fhdc_recalldesk_user');
      document.cookie = 'fhdc_recalldesk_session=; Max-Age=0; path=/; SameSite=Lax';
      document.cookie = 'fhdc_recalldesk_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    } catch {}

    // Use a hard browser navigation. Do not wait for Supabase or client state.
    window.location.href = `/api/auth/logout?ts=${Date.now()}`;
  }

  return (
    <button type="button" onClick={logout} className="logout-button">
      Logout
    </button>
  );
}
