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
    const fromAddress = process.env.SMTP_FROM || '"Hosta" <noreply@hosta.site>';
    const subject = `${code} is your Hosta Verification Code`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
          .header { background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 50%, #06b6d4 100%); padding: 32px 28px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
          .content { padding: 32px 28px; }
          .description { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
          .code-box { background: #f1f5f9; border: 2px dashed #6366f1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
          .code-number { font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4338ca; font-family: 'Courier New', monospace; }
          .expiry-note { font-size: 12px; color: #94a3b8; margin-top: 8px; }
          .footer { padding: 20px 28px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Hosta</h1>
          </div>
          <div class="content">
            <div class="description">
              Thank you for registering for your Hosta Account. Please use the 6-digit confirmation code below to verify your email address and activate your workspace:
            </div>
            <div class="code-box">
              <div class="code-number">${code}</div>
              <div class="expiry-note">⏳ This verification code expires in 15 minutes.</div>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin: 16px 0 0;">
              If you did not request this registration, you can safely ignore this email.
            </p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Hosta. All rights reserved.
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
          text: `Thank you for registering for your Hosta Account. Please use the 6-digit confirmation code below to verify your email address and activate your workspace:\n\n${code}\n\nThis verification code expires in 15 minutes.`,
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

  /**
   * Notify Admin about new GCash payment submission
   */
  async sendAdminPaymentNotification({ adminEmail = 'admin@hosta.ph', student, referenceNumber, receiptUrl, amount = 150 }) {
    const fromAddress = process.env.SMTP_FROM || '"Hosta System" <noreply@hosta.site>';
    const subject = `🔔 [Hosta] New GCash Payment Submission: ${student.name || student.username} (₱${amount})`;

    const refText = referenceNumber ? referenceNumber : 'No Reference (Receipt Screenshot Provided)';
    const receiptHtml = receiptUrl ? `<p><strong>Receipt Screenshot:</strong> <a href="${receiptUrl}" target="_blank" style="color: #0d9488; font-weight: bold;">Click to View Receipt</a></p>` : '';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
          .header { background: linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #042f2e 100%); padding: 28px 24px; color: #ffffff; }
          .header h2 { margin: 0; font-size: 22px; font-weight: 800; }
          .content { padding: 28px 24px; }
          .meta-table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px; }
          .meta-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
          .meta-table td.label { font-weight: 600; color: #64748b; width: 38%; }
          .meta-table td.value { font-weight: 700; color: #0f172a; }
          .action-box { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 10px; padding: 16px; margin-top: 20px; font-size: 13px; color: #115e59; }
          .footer { padding: 18px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>New Student Pass Payment</h2>
            <p style="margin: 6px 0 0; opacity: 0.85; font-size: 13px;">Manual GCash Verification Required</p>
          </div>
          <div class="content">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">
              A student has submitted payment proof for the <strong>Student Monthly Pass</strong>. Please cross-reference this against your GCash transaction history:
            </p>

            <table class="meta-table">
              <tr>
                <td class="label">Student Name:</td>
                <td class="value">${student.name || 'Student'}</td>
              </tr>
              <tr>
                <td class="label">Username:</td>
                <td class="value"><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${student.username}</code></td>
              </tr>
              <tr>
                <td class="label">Student Email:</td>
                <td class="value">${student.email}</td>
              </tr>
              <tr>
                <td class="label">Amount:</td>
                <td class="value" style="color: #0d9488; font-size: 15px;">₱${Number(amount).toFixed(2)}</td>
              </tr>
              <tr>
                <td class="label">GCash Reference No:</td>
                <td class="value" style="font-family: monospace; font-size: 14px; letter-spacing: 0.5px;">${refText}</td>
              </tr>
            </table>

            ${receiptHtml}

            <div class="action-box">
              <strong>Admin Action:</strong> Log into the Hosta Dashboard &rarr; <strong>Payment Approvals</strong> tab to verify and click <strong>Approve</strong> or <strong>Reject</strong>.
            </div>
          </div>
          <div class="footer">
            Hosta Webhosting Automation &bull; Automated Payment Dispatcher
          </div>
        </div>
      </body>
      </html>
    `;

    if (this.isConfigured && this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: fromAddress,
          to: adminEmail,
          subject,
          text: `New GCash Payment Submission: ${student.name} (@${student.username}) for ₱${amount}.\nReference: ${refText}\nLog in to Hosta dashboard to review.`,
          html: htmlContent
        });
        console.log(`[Email Service] Notified admin ${adminEmail} of payment from ${student.username} (MessageId: ${info.messageId})`);
        return { success: true, sent: true };
      } catch (err) {
        console.error(`[Email Service] Failed sending payment notification to admin: ${err.message}`);
        return { success: false, error: err.message };
      }
    } else {
      console.log(`[Email Service SIMULATED] Payment notification to admin ${adminEmail} for student ${student.username} (Ref: ${refText})`);
      return { success: true, sent: false, mode: 'simulation' };
    }
  }

  /**
   * Notify Student that their Pass has been approved
   */
  async sendStudentPaymentApproval({ student }) {
    const fromAddress = process.env.SMTP_FROM || '"Hosta Support" <noreply@hosta.site>';
    const subject = `🎉 Your Hosta Student Pass is Approved! Welcome aboard!`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; }
          .header { background: linear-gradient(135deg, #0d9488 0%, #10b981 100%); padding: 30px 24px; color: #ffffff; text-align: center; }
          .header h2 { margin: 0; font-size: 24px; font-weight: 800; }
          .content { padding: 28px 24px; font-size: 14px; line-height: 1.6; color: #334155; }
          .feature-box { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 10px; padding: 18px; margin: 20px 0; }
          .btn-login { display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; margin-top: 14px; }
          .footer { padding: 18px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Payment Approved! 🎉</h2>
            <p style="margin: 6px 0 0; opacity: 0.9; font-size: 13px;">Your Student Monthly Pass is now active</p>
          </div>
          <div class="content">
            <p>Hi <strong>${student.name || student.username}</strong>,</p>
            <p>Great news! The administrator has verified your GCash payment. Your <strong>Student Monthly Pass</strong> workspace is now fully activated and ready for your web project.</p>
            
            <div class="feature-box">
              <strong style="color: #0f766e;">What's Unlocked:</strong>
              <ul style="margin: 8px 0 0; padding-left: 20px;">
                <li>1 Web Domain (Free <code>*.hosta.site</code> or Custom Domain)</li>
                <li>1 MariaDB Database (phpMyAdmin access)</li>
                <li>100 MB High-Speed SSD Storage &bull; 20 GB Bandwidth</li>
                <li>Free Automated Let's Encrypt SSL</li>
              </ul>
            </div>

            <p style="text-align: center;">
              <a href="https://hosta.site/" class="btn-login" style="color: #ffffff;">Launch Dashboard &rarr;</a>
            </p>
          </div>
          <div class="footer">
            Hosta Webhosting Platform &bull; Philippines
          </div>
        </div>
      </body>
      </html>
    `;

    if (this.isConfigured && this.transporter) {
      try {
        await this.transporter.sendMail({
          from: fromAddress,
          to: student.email,
          subject,
          html: htmlContent
        });
      } catch (err) {
        console.error(`[Email Service] Failed sending approval email: ${err.message}`);
      }
    }
  }

  /**
   * Notify Student if payment proof was rejected
   */
  async sendStudentPaymentRejection({ student, reason }) {
    const fromAddress = process.env.SMTP_FROM || '"Hosta Support" <noreply@hosta.site>';
    const subject = `Notice regarding your Hosta Student Pass payment verification`;

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h3 style="color: #e11d48; margin-top: 0;">Payment Verification Notice</h3>
        <p>Hi <strong>${student.name || student.username}</strong>,</p>
        <p>The administrator was unable to verify your recent GCash payment submission.</p>
        <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px; margin: 16px 0; font-size: 13px; color: #9f1239;">
          <strong>Reason:</strong> ${reason || 'Reference number not found in GCash transaction history or unreadable receipt image.'}
        </div>
        <p style="font-size: 13px; color: #475569;">Please log into your dashboard, double-check your GCash receipt, and resubmit your reference number or screenshot.</p>
      </div>
    `;

    if (this.isConfigured && this.transporter) {
      try {
        await this.transporter.sendMail({
          from: fromAddress,
          to: student.email,
          subject,
          html: htmlContent
        });
      } catch (err) {
        console.error(`[Email Service] Failed sending rejection email: ${err.message}`);
      }
    }
  }
}

module.exports = new EmailService();
