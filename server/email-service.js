/**
 * Hosta - Email Verification & Notification Service
 * Sends transactional registration codes and hosting notifications
 */
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.initTransporter();
  }

  initTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      const port = parseInt(process.env.SMTP_PORT, 10) || 587;
      const secure = process.env.SMTP_SECURE === 'true' || port === 465;

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user,
          pass
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      this.isConfigured = true;
      console.log(`📧 SMTP Email Service initialized via ${host}:${port}`);
    } else {
      this.isConfigured = false;
      console.log('ℹ️  SMTP not fully configured in .env (SMTP_HOST, SMTP_USER, SMTP_PASS). Running in simulation/dev mode.');
    }
  }

  /**
   * Send a 6-digit verification code to student email
   */
  async sendVerificationCode(toEmail, code, studentName = 'Student') {
    const fromAddress = process.env.SMTP_FROM || '"Hosta Philippines" <noreply@hosta.site>';
    const subject = `${code} is your Hosta Student Registration Code`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
          .header { background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 50%, #06b6d4 100%); padding: 32px 28px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
          .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
          .content { padding: 32px 28px; }
          .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
          .description { font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 24px; }
          .code-box { background: #f1f5f9; border: 2px dashed #6366f1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
          .code-number { font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4338ca; font-family: 'Courier New', monospace; }
          .expiry-note { font-size: 12px; color: #94a3b8; margin-top: 8px; }
          .specs-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin: 20px 0; font-size: 13px; color: #475569; }
          .specs-box ul { margin: 8px 0 0; padding-left: 18px; }
          .specs-box li { margin-bottom: 4px; }
          .footer { padding: 20px 28px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Hosta Philippines</h1>
            <p>Student Web Hosting Platform</p>
          </div>
          <div class="content">
            <div class="greeting">Mabuhay, ${studentName}!</div>
            <div class="description">
              Thank you for registering for your <strong>Hosta Student Hosting Account</strong>. Please use the 6-digit confirmation code below to verify your email address and activate your student workspace:
            </div>
            <div class="code-box">
              <div class="code-number">${code}</div>
              <div class="expiry-note">⏳ This verification code expires in 15 minutes.</div>
            </div>
            <div class="specs-box">
              <strong>Your Included Student Monthly Pass:</strong>
              <ul>
                <li>100 MB Fast SSD Storage & 20 GB Monthly Bandwidth</li>
                <li>1 MariaDB Database with direct phpMyAdmin access</li>
                <li>Free <code>.hosta.site</code> student subdomain</li>
                <li>PHP 7.4 - 8.3 & Node.js Runtime</li>
                <li>Live Chat Support with System Administrator</li>
              </ul>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin: 16px 0 0;">
              If you did not request this registration, you can safely ignore this email.
            </p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Hosta Philippines • Cloud Web Hosting for IT & Computer Science Students<br>
            Hosted on Philippines Infrastructure
          </div>
        </div>
      </body>
      </html>
    `;

    if (this.isConfigured && this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: fromAddress,
          to: toEmail,
          subject,
          text: `Mabuhay ${studentName}! Your Hosta verification code is: ${code}. This code expires in 15 minutes.`,
          html: htmlContent
        });
        console.log(`[Email Service] Sent verification code ${code} to ${toEmail} (MessageId: ${info.messageId})`);
        return { success: true, sent: true, mode: 'smtp', messageId: info.messageId };
      } catch (err) {
        console.error(`[Email Service] Failed sending via SMTP: ${err.message}. Falling back to simulation.`);
        console.log(`[Email Service DEMO CODE] Verification code for ${toEmail}: ${code}`);
        return { success: true, sent: false, mode: 'fallback', previewCode: code, error: err.message };
      }
    } else {
      console.log(`[Email Service SIMULATED] Verification code for ${toEmail}: ${code}`);
      return { success: true, sent: false, mode: 'simulation', previewCode: code };
    }
  }
}

module.exports = new EmailService();
