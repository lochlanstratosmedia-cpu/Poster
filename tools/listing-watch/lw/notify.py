"""Send unread notifications by email. Optional: only runs when SMTP details
are set in the environment."""

import os
import smtplib
import ssl
from email.message import EmailMessage


def email_configured():
    return bool(os.environ.get("LW_SMTP_HOST") and os.environ.get("LW_NOTIFY_TO"))


def send_pending(conn):
    """Email every notification not yet emailed. Returns how many were sent."""
    rows = conn.execute("SELECT * FROM notifications WHERE emailed = 0 ORDER BY id").fetchall()
    if not rows or not email_configured():
        return 0
    msg = EmailMessage()
    msg["Subject"] = f"Listing Watch: {rows[-1]['title']}" if len(rows) == 1 else f"Listing Watch: {len(rows)} updates"
    msg["From"] = os.environ.get("LW_SMTP_FROM") or os.environ.get("LW_SMTP_USER") or "listing-watch@localhost"
    msg["To"] = os.environ["LW_NOTIFY_TO"]
    parts = [f"{r['title']}\n{'-' * len(r['title'])}\n{r['body']}\n" for r in rows]
    link = os.environ.get("LW_APP_URL", "")
    msg.set_content("\n".join(parts) + (f"\nOpen Listing Watch: {link}\n" if link else ""))
    host, port = os.environ["LW_SMTP_HOST"], int(os.environ.get("LW_SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=30) as s:
        if port != 25:
            s.starttls(context=ssl.create_default_context())
        if os.environ.get("LW_SMTP_USER"):
            s.login(os.environ["LW_SMTP_USER"], os.environ.get("LW_SMTP_PASSWORD", ""))
        s.send_message(msg)
    conn.executemany("UPDATE notifications SET emailed = 1 WHERE id = ?", [(r["id"],) for r in rows])
    return len(rows)
