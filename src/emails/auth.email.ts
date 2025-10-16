export const otpVerificationEmailTamplate = (OTP: string): string => {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Account Verification | Left Seat Lessons</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #ffffff;
            color: #1a1a1a;
            line-height: 1.5;
            padding: 60px 20px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          .email-container {
            max-width: 480px;
            margin: 0 auto;
            background-color: #ffffff;
            text-align: center;
          }

          .logo-section {
            margin-bottom: 48px;
          }

          .logo img {
            width: 96px;
            height: 96px;
            margin-top: 50px;
          }

          .logo {
            margin: 0 auto 24px;
          }

          .brand-name {
            font-size: 18px;
            font-weight: 700;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
          }

          .title {
            font-size: 36px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 56px;
            letter-spacing: -0.75px;
          }

          .message {
            font-size: 18px;
            color: #374151;
            margin-bottom: 48px;
            line-height: 1.6;
            font-weight: 400;
          }

          .message strong {
            color: #111827;
            font-weight: 600;
          }

          .otp-section {
            margin: 20px 0;
            padding: 48px 32px;
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border-radius: 20px;
            border: 1px solid #e5e7eb;
            position: relative;
          }

          .otp-section::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4);
            border-radius: 20px 20px 0 0;
          }

          .otp-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            font-weight: 600;
            margin-bottom: 24px;
          }

          .otp-code {
            font-size: 48px;
            font-weight: 800;
            color: #1e40af;
            letter-spacing: 12px;
            font-family: "SF Mono", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace;
            margin: 20px 0;
            text-shadow: 0 2px 4px rgba(30, 64, 175, 0.1);
          }

          .otp-validity {
            font-size: 14px;
            color: #9ca3af;
            font-weight: 500;
            margin-top: 16px;
          }

          .divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, #e5e7eb, transparent);
            margin: 48px 0;
          }

          .footer {
            margin-top: 10px;
          }

          .company-info {
            font-size: 16px;
            color: #374151;
            font-weight: 600;
            margin-bottom: 5px;
          }

          .support-section {
            font-size: 14px;
            color: #6b7280;
          }

          .support-link {
            color: #3b82f6;
            text-decoration: none;
            font-weight: 600;
            transition: color 0.2s ease;
          }

          .support-link:hover {
            color: #1e40af;
            text-decoration: underline;
          }

          .copyright {
            font-size: 12px;
            color: #9ca3af;
            margin-top: 10px;
            font-weight: 400;
          }

          @media (max-width: 600px) {
            body {
              padding: 40px 16px;
            }

            .title {
              font-size: 26px;
            }

            .message {
              font-size: 15px;
            }

            .otp-code {
              font-size: 36px;
              letter-spacing: 8px;
            }

            .otp-section {
              padding: 36px 24px;
              margin: 40px 0;
            }

            .logo {
              width: 80px;
              height: 80px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="logo-section">
            <div class="logo">
              <img
                src="https://storage.googleapis.com/left_seat_lessons/unnamed.png"
                alt="Left Seat Lessons"
              />
            </div>
            <div class="brand-name">Left Seat Lessons</div>
          </div>

          <h1 class="title">Account Verification</h1>

          <p class="message">
            Please use the verification code below to verify your account and complete the registration process.
          </p>

          <div class="otp-section">
            <div class="otp-label">Verification Code</div>
            <div class="otp-code">${OTP}</div>
            <div class="otp-validity">Expires in 10 minutes</div>
          </div>

          <div class="divider"></div>

          <div class="footer">
            <div class="company-info">Left Seat Lessons</div>
            <div class="copyright">
              © ${new Date().getFullYear()} Left Seat Lessons. All rights reserved.
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};


export const forgotPasswordOtpTemplate = (OTP: string): string => {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Password Reset | Left Seat Lessons</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #ffffff;
            color: #1a1a1a;
            line-height: 1.5;
            padding: 60px 20px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          .email-container {
            max-width: 480px;
            margin: 0 auto;
            background-color: #ffffff;
            text-align: center;
          }

          .logo-section {
            margin-bottom: 48px;
          }

          .logo img {
            width: 96px;
            height: 96px;
            margin-top: 50px;
          }

          .logo {
            margin: 0 auto 24px;
          }

          .brand-name {
            font-size: 18px;
            font-weight: 700;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
          }

          .title {
            font-size: 36px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 56px;
            letter-spacing: -0.75px;
          }

          .message {
            font-size: 18px;
            color: #374151;
            margin-bottom: 48px;
            line-height: 1.6;
            font-weight: 400;
          }

          .message strong {
            color: #111827;
            font-weight: 600;
          }

          .otp-section {
            margin: 20px 0;
            padding: 48px 32px;
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            border-radius: 20px;
            border: 1px solid #fecaca;
            position: relative;
          }

          .otp-section::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, #ef4444, #dc2626, #b91c1c);
            border-radius: 20px 20px 0 0;
          }

          .otp-label {
            font-size: 12px;
            color: #ef4444;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            font-weight: 600;
            margin-bottom: 24px;
          }

          .otp-code {
            font-size: 48px;
            font-weight: 800;
            color: #dc2626;
            letter-spacing: 12px;
            font-family: "SF Mono", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace;
            margin: 20px 0;
            text-shadow: 0 2px 4px rgba(220, 38, 38, 0.1);
          }

          .otp-validity {
            font-size: 14px;
            color: #ef4444;
            font-weight: 500;
            margin-top: 16px;
          }

          .warning {
            font-size: 14px;
            color: #b91c1c;
            background-color: #fef2f2;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid #fecaca;
            margin: 24px 0;
            text-align: left;
          }

          .divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, #e5e7eb, transparent);
            margin: 48px 0;
          }

          .footer {
            margin-top: 10px;
          }

          .company-info {
            font-size: 16px;
            color: #374151;
            font-weight: 600;
            margin-bottom: 5px;
          }

          .support-section {
            font-size: 14px;
            color: #6b7280;
          }

          .support-link {
            color: #3b82f6;
            text-decoration: none;
            font-weight: 600;
            transition: color 0.2s ease;
          }

          .support-link:hover {
            color: #1e40af;
            text-decoration: underline;
          }

          .copyright {
            font-size: 12px;
            color: #9ca3af;
            margin-top: 10px;
            font-weight: 400;
          }

          @media (max-width: 600px) {
            body {
              padding: 40px 16px;
            }

            .title {
              font-size: 26px;
            }

            .message {
              font-size: 15px;
            }

            .otp-code {
              font-size: 36px;
              letter-spacing: 8px;
            }

            .otp-section {
              padding: 36px 24px;
              margin: 40px 0;
            }

            .logo {
              width: 80px;
              height: 80px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="logo-section">
            <div class="logo">
              <img
                src="https://storage.googleapis.com/left_seat_lessons/unnamed.png"
                alt="Left Seat Lessons"
              />
            </div>
            <div class="brand-name">Left Seat Lessons</div>
          </div>

          <h1 class="title">Password Reset</h1>

          <p class="message">
            You requested to reset your password. Use the verification code below to proceed with resetting your password.
          </p>

          <div class="otp-section">
            <div class="otp-label">Password Reset Code</div>
            <div class="otp-code">${OTP}</div>
            <div class="otp-validity">Expires in 5 minutes</div>
          </div>

          <div class="warning">
            ⚠️ <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email or contact our support team immediately.
          </div>

          <div class="divider"></div>

          <div class="footer">
            <div class="company-info">Left Seat Lessons</div>
            <div class="copyright">
              © ${new Date().getFullYear()} Left Seat Lessons. All rights reserved.
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};


export const forgotPasswordResetOtpTemplate = (OTP: string): string => {
  return `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Password Reset OTP | Left Seat Lessons</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background-color: #ffffff; color: #1a1a1a; line-height: 1.5; padding: 60px 20px; }
        .email-container { max-width: 480px; margin: 0 auto; background-color: #ffffff; text-align: center; }
        .logo-section { margin-bottom: 48px; }
        .logo img { width: 96px; height: 96px; margin-top: 50px; }
        .brand-name { font-size: 18px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
        .title { font-size: 36px; font-weight: 700; color: #111827; margin-bottom: 32px; letter-spacing: -0.75px; }
        .message { font-size: 18px; color: #374151; margin-bottom: 32px; line-height: 1.6; font-weight: 400; }
        .otp-section { margin: 20px 0; padding: 40px 32px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 20px; border: 1px solid #fcd34d; position: relative; }
        .otp-section::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, #f59e0b, #d97706, #b45309); border-radius: 20px 20px 0 0; }
        .otp-label { font-size: 12px; color: #b45309; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; margin-bottom: 24px; }
        .otp-code { font-size: 48px; font-weight: 800; color: #b45309; letter-spacing: 12px; font-family: "SF Mono", "Courier New", monospace; margin: 20px 0; text-shadow: 0 2px 4px rgba(180, 83, 9, 0.1); }
        .otp-validity { font-size: 14px; color: #92400e; font-weight: 500; margin-top: 16px; }
        .warning { font-size: 14px; color: #b91c1c; background-color: #fef2f2; padding: 12px 16px; border-radius: 8px; border: 1px solid #fecaca; margin: 24px 0; text-align: left; }
        .divider { height: 1px; background: linear-gradient(90deg, transparent, #e5e7eb, transparent); margin: 48px 0; }
        .footer { margin-top: 10px; }
        .company-info { font-size: 16px; color: #374151; font-weight: 600; margin-bottom: 5px; }
        .copyright { font-size: 12px; color: #9ca3af; margin-top: 10px; font-weight: 400; }
        @media (max-width: 600px) {
          body { padding: 40px 16px; }
          .title { font-size: 26px; }
          .message { font-size: 15px; }
          .otp-code { font-size: 36px; letter-spacing: 8px; }
          .otp-section { padding: 36px 24px; margin: 40px 0; }
          .logo { width: 80px; height: 80px; }
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="logo-section">
          <div class="logo">
            <img src="https://storage.googleapis.com/left_seat_lessons/unnamed.png" alt="Left Seat Lessons" />
          </div>
          <div class="brand-name">Left Seat Lessons</div>
        </div>

        <h1 class="title">Reset Your Password</h1>

        <p class="message">
          You requested a password reset. Use the verification code below to reset your password.
        </p>

        <div class="otp-section">
          <div class="otp-label">Reset Code</div>
          <div class="otp-code">${OTP}</div>
          <div class="otp-validity">Expires in 5 minutes</div>
        </div>

        <div class="warning">
          ⚠️ <strong>Security Notice:</strong> If you didn’t request this, ignore this email or contact support immediately.
        </div>

        <div class="divider"></div>

        <div class="footer">
          <div class="company-info">Left Seat Lessons</div>
          <div class="copyright">
            © ${new Date().getFullYear()} Left Seat Lessons. All rights reserved.
          </div>
        </div>
      </div>
    </body>
  </html>
  `;
};


export const twoFactorOtpTemplate = (OTP: string): string => {
  return `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Two-Factor Authentication OTP | Left Seat Lessons</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background-color: #ffffff; color: #1a1a1a; line-height: 1.5; padding: 60px 20px; }
        .email-container { max-width: 480px; margin: 0 auto; background-color: #ffffff; text-align: center; }
        .logo-section { margin-bottom: 48px; }
        .logo img { width: 96px; height: 96px; margin-top: 50px; }
        .brand-name { font-size: 18px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
        .title { font-size: 36px; font-weight: 700; color: #111827; margin-bottom: 32px; letter-spacing: -0.75px; }
        .message { font-size: 18px; color: #374151; margin-bottom: 32px; line-height: 1.6; font-weight: 400; }
        .otp-section { margin: 20px 0; padding: 40px 32px; background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 20px; border: 1px solid #93c5fd; position: relative; }
        .otp-section::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, #3b82f6, #2563eb, #1d4ed8); border-radius: 20px 20px 0 0; }
        .otp-label { font-size: 12px; color: #1d4ed8; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; margin-bottom: 24px; }
        .otp-code { font-size: 48px; font-weight: 800; color: #1e40af; letter-spacing: 12px; font-family: "SF Mono", "Courier New", monospace; margin: 20px 0; text-shadow: 0 2px 4px rgba(30, 64, 175, 0.1); }
        .otp-validity { font-size: 14px; color: #3b82f6; font-weight: 500; margin-top: 16px; }
        .warning { font-size: 14px; color: #1e3a8a; background-color: #dbeafe; padding: 12px 16px; border-radius: 8px; border: 1px solid #93c5fd; margin: 24px 0; text-align: left; }
        .divider { height: 1px; background: linear-gradient(90deg, transparent, #e5e7eb, transparent); margin: 48px 0; }
        .footer { margin-top: 10px; }
        .company-info { font-size: 16px; color: #374151; font-weight: 600; margin-bottom: 5px; }
        .copyright { font-size: 12px; color: #9ca3af; margin-top: 10px; font-weight: 400; }
        @media (max-width: 600px) {
          body { padding: 40px 16px; }
          .title { font-size: 26px; }
          .message { font-size: 15px; }
          .otp-code { font-size: 36px; letter-spacing: 8px; }
          .otp-section { padding: 36px 24px; margin: 40px 0; }
          .logo { width: 80px; height: 80px; }
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="logo-section">
          <div class="logo">
            <img src="https://storage.googleapis.com/left_seat_lessons/unnamed.png" alt="Left Seat Lessons" />
          </div>
          <div class="brand-name">Left Seat Lessons</div>
        </div>

        <h1 class="title">Two-Factor Authentication</h1>

        <p class="message">
          To complete your login, please use the verification code below.
        </p>

        <div class="otp-section">
          <div class="otp-label">Your 2FA Code</div>
          <div class="otp-code">${OTP}</div>
          <div class="otp-validity">Expires in 5 minutes</div>
        </div>

        <div class="warning">
          ⚠️ <strong>Security Notice:</strong> If you didn't request this code, please secure your account immediately.
        </div>

        <div class="divider"></div>

        <div class="footer">
          <div class="company-info">Left Seat Lessons</div>
          <div class="copyright">
            © ${new Date().getFullYear()} Left Seat Lessons. All rights reserved.
          </div>
        </div>
      </div>
    </body>
  </html>
  `;
};
