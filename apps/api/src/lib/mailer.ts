/**
 * Outgoing email (password-reset links). SMTP through nodemailer when SMTP_URL is set; in
 * local development that points at Mailpit (npm run mail:up), which catches every message
 * in a local inbox instead of delivering it. Never logs message bodies or links.
 */
import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createSmtpMailer(cfg: { url: string; from: string }): Mailer {
  const transport = nodemailer.createTransport(cfg.url);
  return {
    async send(mail) {
      await transport.sendMail({ from: cfg.from, ...mail });
    },
  };
}
