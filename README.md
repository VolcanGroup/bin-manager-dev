# BIN Manager v2

**Portal de Administración de BINes**

Una aplicación web para la gestión, segmentación y auditoría de **BINs (Bank Identification Numbers)**, enfocada en operaciones de tarjetas (Prepago, Débito) principalmente para El Salvador, Honduras y Costa Rica.

## Características Principales

- **Gestión de BINs**: Visualización, creación, edición, segmentación (desglose de BINs de 8 dígitos a 10 dígitos) y desegmentación.
- **Autenticación y Autorización**: Sistema de usuarios con roles para controlar el acceso a la plataforma.
- **Administración de Solicitudes**: Flujo de aprobación para altas de BINs (Pendiente, Aprobado, Rechazado).
- **Auditoría**: Registro de acciones realizadas por los usuarios en el sistema.
- **Catálogos**: Gestión de países asociados a los BINs.
- **Modos de Operación**: Soporta **SQLite** (local) y **PostgreSQL** (nube) de forma transparente.

## Estructura del Proyecto

- `server.js`: Punto de entrada de la aplicación Node.js / Express.
- `db_connector.js`: Selector dinámico de base de datos (SQLite vs PostgreSQL).
- `database.js`: Implementación para SQLite (Local).
- `database_pg.js`: Implementación para PostgreSQL (Nube/Supabase/Render).
- `routes/`: Controladores de la API REST (ahora totalmente asíncronos para compatibilidad con la nube).
- `middleware/`: Autenticación JWT y validación de roles.
- `public/`: Frontend de la aplicación web (HTML, CSS y Vanilla JS).

## Requisitos Previos

- [Node.js](https://nodejs.org/) (v14 o superior)
- Una cuenta en [Supabase](https://supabase.com/) (para PostgreSQL) si se desea desplegar en la nube.
- Una cuenta en [Render](https://render.com/) para hosting.

## Instalación y Configuración Local

1. **Instalar dependencias**:
   ```bash
   npm install
   ```
2. **Ejecutar servidor**:
   ```bash
   npm start
   ```
   La aplicación usará **SQLite** automáticamente en `data/database.sqlite`.

## Despliegue en la Nube (Render + Supabase)

La aplicación detecta automáticamente si debe usar PostgreSQL mediante la variable de entorno `DATABASE_URL`.

### 1. Variables de Entorno Requeridas
En Render.com, configura las siguientes variables:
- `DATABASE_URL`: Tu cadena de conexión de Supabase (ej: `postgres://user:pass@host:5432/db`).
- `JWT_SECRET`: Una cadena aleatoria para firmar los tokens de sesión.
- `PORT`: Generalmente `3000` o asignado por Render.

### 2. Base de Datos
Al conectar por primera vez a una base de datos PostgreSQL vacía, la aplicación ejecutará automáticamente el script de inicialización para crear las tablas y el usuario administrador inicial.

## Tecnologías

- **Backend**: Node.js, Express.js.
- **Base de Datos**: SQLite (Local) / PostgreSQL (Producción).
- **Frontend**: Vanilla JavaScript (SPA), CSS3.
- **Seguridad**: JWT (sesiones), Bcrypt (contraseñas).

---
**Credenciales iniciales:** `admin` / `admin123`
