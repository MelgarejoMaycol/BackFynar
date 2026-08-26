<div align="center">

# Fynar API

### Backend financiero de Fynar · Node.js + Express + TypeScript + PostgreSQL

[![Frontend](https://img.shields.io/badge/Frontend-frontFynar-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/MelgarejoMaycol/frontFynar)
[![Demo](https://img.shields.io/badge/Demo-fynar.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://fynar.vercel.app)

![Node](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma&logoColor=white)

</div>

## Sobre Fynar

**Fynar** es una plataforma de gestión financiera personal diseñada para centralizar cuentas, movimientos, presupuestos, deudas, tarjetas de crédito, obligaciones y reportes en un mismo sistema.

Este repositorio contiene la **API y el núcleo de reglas de negocio**. El backend actúa como fuente de verdad para los cálculos financieros, saldos y agregados que consumen los clientes web y, a futuro, otros clientes como la aplicación móvil.

La intención del proyecto es resolver un problema real de producto: no solo almacenar ingresos y gastos, sino construir una base técnica capaz de evolucionar hacia análisis financiero, simulaciones y asistencia inteligente sin tener que rehacer toda la arquitectura.

## Capacidades actuales

El backend está dividido por dominios y actualmente contiene módulos para:

- **Autenticación y usuarios:** registro, verificación, login, refresh de sesión, logout y recuperación.
- **Workspaces:** aislamiento de la información financiera por espacio.
- **Cuentas financieras:** administración de cuentas y saldos.
- **Categorías:** clasificación de ingresos y gastos.
- **Movimientos:** ingresos, gastos, transferencias y operaciones asociadas.
- **Presupuestos:** definición y seguimiento del gasto presupuestado.
- **Dashboard:** agregados financieros utilizados por la pantalla principal.
- **Reportes:** consultas y resúmenes financieros.
- **Tarjetas de crédito:** cupo, saldo, compras, extractos y pagos.
- **Deudas y créditos:** saldos, cuotas, pagos y estructura de amortización.
- **Obligaciones recurrentes:** compromisos de pago y próximas ocurrencias.
- **Pasivos:** capa de agregación para la vista consolidada de obligaciones financieras.
- **Parámetros:** configuración necesaria para reglas y formularios financieros.
- **Health checks:** verificación de disponibilidad del servicio.

## Qué demuestra este backend

Más allá de exponer endpoints CRUD, Fynar concentra decisiones de arquitectura y reglas de dominio que normalmente aparecen en aplicaciones de producción:

- Arquitectura de **monolito modular**, evitando microservicios prematuros.
- Separación entre rutas, controladores, servicios, repositorios y validadores.
- Persistencia relacional con **PostgreSQL + Prisma**.
- Operaciones monetarias mediante `Decimal(18,2)` en lugar de `float`.
- Fechas financieras almacenadas con tipos adecuados para zona horaria.
- Aislamiento de datos por `workspaceId`.
- Transacciones de base de datos para operaciones financieras relacionadas.
- Eliminación lógica en entidades donde se necesita conservar trazabilidad.
- Validación de entrada con **Zod**.
- Pruebas unitarias e integración con **Vitest + Supertest**.
- Scripts de verificación de esquema, migraciones y build reproducible.

## Arquitectura

Fynar utiliza un **monolito modular**: una única API desplegable y una base de datos principal, pero con los dominios separados por responsabilidad.

```text
Cliente Web / Cliente Móvil
            │
            ▼
       HTTPS / REST
            │
            ▼
       Express API
            │
   ┌────────┼─────────┐
   ▼        ▼         ▼
Servicios  Repos.   Middlewares
   │        │
   └────┬───┘
        ▼
   Prisma ORM
        │
        ▼
   PostgreSQL
```

Estructura principal:

```text
src/
├── common/          # errores, middlewares, logging y utilidades
├── config/          # configuración y variables de entorno
├── database/        # Prisma y utilidades de persistencia
├── modules/         # dominios de negocio
│   ├── accounts/
│   ├── auth/
│   ├── budgets/
│   ├── cards/
│   ├── categories/
│   ├── dashboard/
│   ├── debts/
│   ├── health/
│   ├── liabilities/
│   ├── obligations/
│   ├── parameters/
│   ├── reports/
│   ├── transactions/
│   ├── users/
│   └── workspaces/
├── app.ts
└── server.ts
```

Dentro de los módulos se mantiene una separación similar a:

```text
routes → controller → service → repository → database
                     ↓
              reglas de negocio
```

## Seguridad y autenticación

La autenticación está diseñada para reducir riesgos comunes en aplicaciones web:

- Contraseñas protegidas con **Argon2id**.
- **Access tokens JWT** firmados desde el backend.
- Refresh tokens opacos almacenados en la base únicamente mediante **hash**.
- Rotación de refresh tokens en cada renovación de sesión.
- Detección de reutilización de refresh tokens y revocación de la familia comprometida.
- Sesiones asociadas a metadatos como dispositivo, IP y agente de usuario cuando están disponibles.
- Cookies de producción configuradas para trabajar como `HttpOnly` y `Secure` desde el flujo web.
- **Helmet**, CORS y rate limiting como capas adicionales de protección HTTP.
- Errores controlados sin exponer stack traces al cliente en producción.

## Modelo financiero

Una de las prioridades del backend es mantener consistencia en operaciones monetarias.

Ejemplos del esquema actual:

- Importes almacenados como `Decimal(18,2)`.
- Identificadores UUID.
- Fechas temporales mediante `TIMESTAMPTZ` y fechas financieras mediante `DATE` cuando corresponde.
- Presupuestos relacionados con cuentas y categorías.
- Cuotas y pagos de deuda con desglose entre capital, interés, seguros y cargos.
- Idempotencia en operaciones financieras donde una repetición accidental podría duplicar un pago.
- Registros de auditoría preparados para conservar cambios relevantes.

## Stack técnico

| Área | Tecnología |
| --- | --- |
| Runtime | Node.js 22 |
| API | Express 5 |
| Lenguaje | TypeScript 6 + ES Modules |
| Base de datos | PostgreSQL |
| ORM | Prisma |
| Validación | Zod |
| Autenticación | JWT, tokens opacos, Argon2id |
| Seguridad HTTP | Helmet, CORS, express-rate-limit |
| Testing | Vitest, Supertest |
| Multimedia | Cloudinary, Multer, Sharp |
| Email | Resend / proveedor configurable |
| Deploy | Render |

## Calidad y verificación

El proyecto incluye scripts separados para desarrollo, pruebas, migraciones y validación completa.

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run prisma:validate
```

Para ejecutar la verificación principal:

```bash
npm run verify
```

El flujo de verificación cubre:

```text
TypeScript → ESLint → Prettier → Tests → Build → Prisma validate
```

También existen comandos para pruebas de integración y comprobación del esquema de base de datos.

## Instalación local

### Requisitos

- Node.js 22
- npm
- PostgreSQL

### Configuración

```bash
git clone https://github.com/MelgarejoMaycol/BackFynar.git
cd BackFynar
npm ci
copy .env.example .env
npm run prisma:generate
```

Configura en `.env` al menos la conexión de PostgreSQL y los secretos necesarios para autenticación.

> Nunca se debe versionar el archivo `.env` ni exponer secretos, contraseñas o credenciales de proveedores.

### Migraciones

```bash
npm run prisma:migrate:deploy
npm run prisma:seed
```

### Desarrollo

```bash
npm run dev
```

La API utiliza el prefijo:

```text
/api/v1
```

## Health check

El servicio expone un endpoint de disponibilidad utilizado también por Render:

```text
GET /api/v1/health/live
```

## Producción

El repositorio incluye `render.yaml` para desplegar la API en Render con:

- Node.js 22.
- build reproducible.
- migraciones antes de iniciar el servidor.
- health check automático.
- configuración explícita de CORS para la aplicación web.

El frontend público se encuentra en:

**https://fynar.vercel.app**

Repositorio del cliente web:

**https://github.com/MelgarejoMaycol/frontFynar**

## Documentación técnica ampliada

La visión funcional, reglas de negocio, convenciones y decisiones de arquitectura de Fynar se documentan con mayor detalle en:

[`README_FYNAR.md`](./README_FYNAR.md)

Ese documento funciona como referencia de dominio para mantener consistencia al evolucionar el proyecto.

## Estado del proyecto

Fynar se encuentra en **desarrollo activo**. El backend está preparado para continuar creciendo por módulos sin convertir la aplicación en un conjunto de servicios distribuidos innecesariamente.

---

<div align="center">

Desarrollado por **Maycol Melgarejo**

[GitHub](https://github.com/MelgarejoMaycol) · [Portafolio](https://melgarejomaycol.vercel.app/)

</div>
