# BIN Manager v2

**Portal de Administración de BINes**

Una aplicación web para la gestión, segmentación y auditoría de **BINs (Bank Identification Numbers)**, enfocada en operaciones de tarjetas (Prepago, Débito) principalmente para El Salvador, Honduras y Costa Rica.

## Características Principales

- **Gestión de BINs**: Visualización, creación, edición, segmentación (desglose de BINs de 8 dígitos a 10 dígitos) y desegmentación.
- **Autenticación y Autorización**: Sistema de usuarios con roles para controlar el acceso a la plataforma.
- **Administración de Solicitudes**: Flujo de aprobación para altas de BINs (Pendiente, Aprobado, Rechazado).
- **Auditoría**: Registro de acciones realizadas por los usuarios en el sistema.
- **Catálogos**: Gestión de países asociados a los BINs.
- **Modos de Operación**: Soporta **SQLite** (local), **MariaDB** y **PostgreSQL** de forma transparente.

## Estructura del Proyecto

- `server.js`: Punto de entrada de la aplicación Node.js / Express.
- `db_connector.js`: Selector dinámico de base de datos (SQLite, MariaDB o PostgreSQL).
- `database.js`: Implementación para SQLite (Desarrollo/Local).
- `database_mariadb.js`: Implementación para MariaDB (Producción).
- `database_pg.js`: Implementación para PostgreSQL.
- `routes/`: Controladores de la API REST (totalmente asíncronos para compatibilidad de bases de datos).
- `middleware/`: Autenticación JWT y validación de roles.
- `public/`: Frontend de la aplicación web (HTML, CSS y Vanilla JS).

## Requisitos Previos

- [Node.js](https://nodejs.org/) (v14 o superior)
- MariaDB o MySQL (si se despliega en producción)
- [PM2](https://pm2.keymetrics.io/) (para gestión de procesos en producción)

## Instalación y Configuración Local (Desarrollo)

1. **Instalar dependencias**:
   ```bash
   npm install
   ```
2. **Ejecutar servidor localmente**:
   ```bash
   npm start
   ```
   *Nota: Si no se define una variable de base de datos, la aplicación usará **SQLite** automáticamente creando el archivo en `data/database.sqlite`.*

## Despliegue en Producción (Windows Server + PM2)

El entorno de producción utiliza **MariaDB** y es gestionado mediante **PM2**.

### 1. Variables de Entorno Requeridas (`.env`)
Configura las siguientes variables en la raíz del proyecto:
- `MARIADB_URI`: Cadena de conexión (ej: `mysql://root:password@localhost:3306/bin_manager_dev`).
- `JWT_SECRET`: Una cadena segura para firmar los tokens de sesión.
- `PORT`: Puerto donde correrá la aplicación (ej: `3001`).

### 2. Base de Datos
Al conectar por primera vez a una base de datos MariaDB vacía, la aplicación ejecutará automáticamente el script de inicialización para crear las tablas y el usuario administrador inicial (`admin` / `admin123`).

### 3. Iniciar el Servidor con PM2
```bash
pm2 start server.js --name "BIN-Manager-DEV"
pm2 save
```
Para aplicar cambios futuros:
```bash
pm2 restart all
```

## Integración de Correos Electrónicos (Notificaciones)

La plataforma envía correos automáticos usando **Nodemailer** y un servidor SMTP. 

### Variables de Entorno Adicionales (`.env`)
- `SMTP_HOST`: Servidor SMTP (ej: `smtp.office365.com` o `smtp.gmail.com`).
- `SMTP_PORT`: Puerto del servidor (ej: `587` o `465`).
- `SMTP_SECURE`: `true` para puerto 465, o `false` para 587 (TLS).
- `SMTP_USER`: Correo remitente autorizado.
- `SMTP_PASS`: Contraseña o App Password del correo.

### Lógica de Notificaciones
- **Nuevas Solicitudes**: Se notifica a **todos** los usuarios con rol `admin` que tengan un correo registrado en la tabla `users` de la base de datos (se ignora cualquier correo quemado en el `.env`).
- **Aprobación / Rechazo**: El sistema busca el correo del usuario "solicitante" (creador original del registro) en la tabla `users` y le notifica exclusivamente a él sobre la resolución de su solicitud.

## Tecnologías

- **Backend**: Node.js, Express.js.
- **Base de Datos**: MariaDB (Producción) / SQLite (Local).
- **Gestor de Procesos**: PM2.
- **Frontend**: Vanilla JavaScript (SPA), CSS3.
- **Seguridad**: JWT (sesiones), Bcrypt (contraseñas).

---
**Credenciales iniciales:** `admin` / `admin123`
