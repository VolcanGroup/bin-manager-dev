const nodemailer = require('nodemailer');
const { queryAll } = require('./db_connector');

function getTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.office365.com",
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        }
    });
}

async function sendNewRequestEmail(requestData, requesterFullName) {
    let adminEmails = '';
    
    // Get admin emails strictly from the DB
    try {
        const admins = await queryAll("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != ''");
        if (admins && admins.length > 0) {
            adminEmails = admins.map(a => a.email.trim()).filter(e => e).join(',');
        }
    } catch (e) {
        console.error("Error fetching admin emails from DB:", e);
    }

    if (!adminEmails) {
        console.warn("No ADMIN_EMAILS available. Skipping email notification.");
        return;
    }

    const {
        proposed_bin, product, digits, brand, client, embosser,
        requester_username, requiere_tokenizacion, segment, country,
        bin_type, keys, balance_type
    } = requestData;

    const displayName = requesterFullName || requester_username;

    try {
        const transporter = getTransporter();
        const mailOptions = {
            from: `"BIN Manager" <${process.env.SMTP_USER}>`,
            to: adminEmails,
            subject: `[BIN Manager] Nueva solicitud de BIN pendiente`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
                    <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Nueva Solicitud de BIN</h2>
                    <p style="font-size: 16px; color: #333;">El usuario <strong>${displayName}</strong> ha creado una nueva solicitud de BIN que requiere tu aprobación.</p>
                    
                    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; width: 40%; background-color: #f9f9f9;">BIN Propuesto</td><td style="padding: 10px; border: 1px solid #ddd;">${proposed_bin}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Producto</td><td style="padding: 10px; border: 1px solid #ddd;">${product}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Segmento</td><td style="padding: 10px; border: 1px solid #ddd;">${segment || '-'}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Dígitos</td><td style="padding: 10px; border: 1px solid #ddd;">${digits}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Marca</td><td style="padding: 10px; border: 1px solid #ddd;">${brand}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">País</td><td style="padding: 10px; border: 1px solid #ddd;">${country || '-'}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Cliente</td><td style="padding: 10px; border: 1px solid #ddd;">${client}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Embozador</td><td style="padding: 10px; border: 1px solid #ddd;">${embosser || '-'}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Tipo de BIN</td><td style="padding: 10px; border: 1px solid #ddd;">${bin_type || '-'}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Llaves</td><td style="padding: 10px; border: 1px solid #ddd;">${keys || '-'}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Tipo de Saldos</td><td style="padding: 10px; border: 1px solid #ddd;">${balance_type || '-'}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background-color: #f9f9f9;">Tokenizado</td><td style="padding: 10px; border: 1px solid #ddd;">${requiere_tokenizacion}</td></tr>
                    </table>

                    <div style="text-align: center; margin-top: 30px;">
                        <a href="http://10.23.105.36:3001" style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Ir al BIN Manager</a>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log("Email notification sent: %s", info.messageId);
    } catch (error) {
        console.error("Error sending email notification:", error);
    }
}

async function sendApprovalEmail(requestData, requesterEmail, requesterName) {
    if (!requesterEmail) return;

    const { proposed_bin, client } = requestData;
    const displayName = requesterName || 'Usuario';

    try {
        const transporter = getTransporter();
        const mailOptions = {
            from: `"BIN Manager" <${process.env.SMTP_USER}>`,
            to: requesterEmail,
            subject: `[BIN Manager] Tu solicitud de BIN fue APROBADA`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
                    <h2 style="color: #27ae60; border-bottom: 2px solid #2ecc71; padding-bottom: 10px;">Solicitud Aprobada</h2>
                    <p style="font-size: 16px; color: #333;">Hola <strong>${displayName}</strong>,</p>
                    <p style="font-size: 16px; color: #333;">Te informamos que tu solicitud de BIN ha sido <strong>APROBADA</strong> por un administrador.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px; margin-bottom: 20px;">
                        <p style="margin: 5px 0;"><strong>Cliente:</strong> ${client}</p>
                        <p style="margin: 5px 0;"><strong>BIN Asignado:</strong> <span style="color: #27ae60; font-size: 18px; font-weight: bold;">${proposed_bin}</span></p>
                    </div>

                    <p style="font-size: 14px; color: #666;">El BIN ya está asignado oficialmente y listo para usarse. Puedes consultar los detalles en la plataforma.</p>

                    <div style="text-align: center; margin-top: 30px;">
                        <a href="http://10.23.105.36:3001" style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Ir al BIN Manager</a>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log("Approval email sent to:", requesterEmail);
    } catch (error) {
        console.error("Error sending approval email:", error);
    }
}

async function sendRejectionEmail(requestData, requesterEmail, requesterName) {
    if (!requesterEmail) return;

    const { proposed_bin, client } = requestData;
    const displayName = requesterName || 'Usuario';

    try {
        const transporter = getTransporter();
        const mailOptions = {
            from: `"BIN Manager" <${process.env.SMTP_USER}>`,
            to: requesterEmail,
            subject: `[BIN Manager] Tu solicitud de BIN fue RECHAZADA`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
                    <h2 style="color: #c0392b; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">Solicitud Rechazada</h2>
                    <p style="font-size: 16px; color: #333;">Hola <strong>${displayName}</strong>,</p>
                    <p style="font-size: 16px; color: #333;">Te informamos que tu solicitud de BIN ha sido <strong>RECHAZADA</strong> por un administrador.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px; margin-bottom: 20px;">
                        <p style="margin: 5px 0;"><strong>Cliente:</strong> ${client}</p>
                        <p style="margin: 5px 0;"><strong>BIN Solicitado:</strong> <span style="color: #c0392b; font-weight: bold;">${proposed_bin}</span></p>
                    </div>

                    <p style="font-size: 14px; color: #666;">El BIN fue liberado y no se te asignó. Si tienes dudas, comunícate con un administrador de la plataforma.</p>

                    <div style="text-align: center; margin-top: 30px;">
                        <a href="http://10.23.105.36:3001" style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Ir al BIN Manager</a>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log("Rejection email sent to:", requesterEmail);
    } catch (error) {
        console.error("Error sending rejection email:", error);
    }
}

module.exports = {
    sendNewRequestEmail,
    sendApprovalEmail,
    sendRejectionEmail
};
