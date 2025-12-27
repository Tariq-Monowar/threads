"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTwoFactorOtp = exports.sendForgotPasswordOTP = exports.forgotPasswordEmail = exports.otpVerificationEmail = exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_email_1 = require("../emails/auth.email");
dotenv_1.default.config();
const sendEmail = async (to, subject, htmlContent) => {
    const mailTransporter = nodemailer_1.default.createTransport({
        service: "gmail",
        port: 587,
        auth: {
            user: process.env.NODE_MAILER_EMAIL,
            pass: process.env.NODE_MAILER_PASSWORD,
        },
    });
    const mailOptions = {
        from: `"BBS" <tqmhosain@gmail.com>`,
        to,
        subject,
        html: htmlContent,
    };
    await mailTransporter.sendMail(mailOptions);
};
exports.sendEmail = sendEmail;
//registaion user otp email
const otpVerificationEmail = async (email, otp) => {
    const htmlContent = (0, auth_email_1.otpVerificationEmailTamplate)(otp);
    await (0, exports.sendEmail)(email, "OTP Verification Email", htmlContent);
};
exports.otpVerificationEmail = otpVerificationEmail;
// Add this new email sending function
const forgotPasswordEmail = async (email, otp) => {
    const htmlContent = (0, auth_email_1.forgotPasswordOtpTemplate)(otp);
    await (0, exports.sendEmail)(email, "Password Reset Verification Code", htmlContent);
};
exports.forgotPasswordEmail = forgotPasswordEmail;
const sendForgotPasswordOTP = async (email, otp) => {
    const htmlContent = (0, auth_email_1.forgotPasswordResetOtpTemplate)(otp);
    await (0, exports.sendEmail)(email, "Password Reset Verification Code", htmlContent);
};
exports.sendForgotPasswordOTP = sendForgotPasswordOTP;
//Two Factor Otp Template
const sendTwoFactorOtp = async (email, otp) => {
    const htmlContent = (0, auth_email_1.twoFactorOtpTemplate)(otp);
    await (0, exports.sendEmail)(email, "Two-Factor Authentication Code", htmlContent);
};
exports.sendTwoFactorOtp = sendTwoFactorOtp;
//# sourceMappingURL=email.config.js.map