"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      await fetch("/api/logout", {
        method: "POST",
        cache: "no-store",
      });
    } catch {
      // Even if the API call fails, still force the browser out of the session view.
    } finally {
      window.location.replace(`/login?loggedOut=1&t=${Date.now()}`);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loggingOut}
      className="logout-button"
    >
      {loggingOut ? "Logging out..." : "Logout"}
    </button>
  );
}