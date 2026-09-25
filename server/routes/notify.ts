import express from "express";
import nodemailer from "nodemailer";

export function registerNotifyRoutes(app: express.Express) {
  app.post("/api/notify", async (req, res) => {
    const { subject, message } = req.body;
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("SMTP not configured, skipping email notification");
      return res.json({ success: false, message: "SMTP not configured" });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: process.env.SMTP_TO || process.env.SMTP_USER,
        subject: subject || "CryptoQuant AI notification",
        text: message,
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Email notification failed:", error);
      res.status(500).json({ success: false, error: error.message || "Email notification failed" });
    }
  });
}
