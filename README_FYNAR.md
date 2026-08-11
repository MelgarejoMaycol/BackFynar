# Fynar

> Plataforma web y móvil para administrar, comprender y anticipar la situación financiera personal mediante reglas financieras, análisis de datos e inteligencia artificial.

---

## 1. Propósito de este documento

Este archivo es la referencia técnica y funcional principal del proyecto **Fynar**.

Debe utilizarse como contexto obligatorio antes de:

- crear o modificar funcionalidades;
- diseñar endpoints;
- modificar la base de datos;
- generar migraciones;
- crear módulos, controladores, servicios, repositorios o validadores;
- implementar autenticación o permisos;
- desarrollar la aplicación web o móvil;
- integrar inteligencia artificial;
- crear pruebas;
- corregir errores;
- realizar refactorizaciones;
- proponer cambios de arquitectura.

Este README busca evitar que una persona o una inteligencia artificial implemente código sin comprender:

1. qué problema resuelve Fynar;
2. qué funcionalidades pertenecen al MVP;
3. qué funcionalidades son futuras;
4. cómo está organizada la arquitectura;
5. cómo funciona el modelo de datos;
6. qué reglas de negocio no deben romperse;
7. qué decisiones técnicas ya fueron tomadas.

Cuando exista una contradicción entre una implementación y este documento, se debe detener el cambio, identificar la discrepancia y confirmar cuál debe ser la fuente de verdad antes de continuar.

---

## 2. Resumen ejecutivo

Fynar es un **copiloto financiero personal** disponible desde web y móvil.

No debe limitarse a registrar ingresos y gastos. Su propósito es ayudar al usuario a responder tres preguntas de manera permanente:

### ¿Dónde está mi dinero?

Debe mostrar, entre otros:

- efectivo;
- cuentas bancarias;
- billeteras digitales;
- cuentas de ahorro;
- inversiones;
- tarjetas y obligaciones.

### ¿En qué se fue mi dinero?

Debe explicar los gastos por:

- categoría;
- cuenta;
- periodo;
- comercio;
- hábito;
- recurrencia;
- tendencia.

### ¿Qué pasará con mi dinero?

Debe estimar y explicar situaciones como:

- si el usuario llegará con liquidez a fin de mes;
- si podrá pagar sus obligaciones;
- cuánto podría ahorrar;
- qué gasto debería reducir;
- cuándo terminará de pagar una deuda;
- cómo afectaría una compra futura;
- cuál podría ser su saldo en una fecha determinada;
- si su situación financiera está mejorando o empeorando.

Fynar no debe sentirse como un programa contable. Debe sentirse como un asesor financiero personal, claro, rápido y orientado a decisiones.

---

## 3. Visión del proyecto

Desarrollar una plataforma web y móvil que permita a las personas administrar completamente sus finanzas personales mediante un asistente inteligente capaz de analizar ingresos, gastos, cuentas, deudas, presupuestos, metas y hábitos financieros.

La plataforma almacenará información, aplicará reglas financieras, calculará indicadores, detectará patrones y generará recomendaciones accionables.

### Visión a largo plazo

Fynar debe poder evolucionar desde una aplicación personal hacia una plataforma que también soporte:

- espacios financieros familiares;
- contadores con múltiples clientes;
- asesores financieros autorizados;
- pequeñas empresas y emprendimientos;
- Open Finance o conexiones bancarias donde sea posible;
- inversiones;
- seguros;
- herramientas tributarias;
- puntaje de salud financiera;
- servicios especializados de inteligencia financiera.

La arquitectura inicial debe permitir esta evolución sin obligar a rehacer completamente el backend.

---

## 4. Problema que resuelve

Muchas personas no saben con precisión:

- cuánto dinero tienen disponible;
- cuánto gastan realmente;
- en qué categorías se concentra su gasto;
- cuánto deben;
- cuánto interés han pagado;
- cuándo terminarán de pagar sus créditos;
- cuánto pueden ahorrar;
- si podrán cubrir sus obligaciones futuras;
- si una compra nueva afectará su estabilidad;
- si están mejor o peor que meses atrás.

Las aplicaciones financieras tradicionales suelen presentar datos y gráficas, pero con frecuencia no traducen esos datos en decisiones concretas.

Fynar busca cubrir esa necesidad combinando:

- registro financiero;
- reglas de negocio;
- análisis histórico;
- pronósticos;
- simulaciones;
- recomendaciones inteligentes.

---

## 5. Objetivo general

Crear un asistente financiero inteligente que permita administrar, analizar y predecir la situación económica del usuario mediante información histórica, reglas financieras y modelos de pronóstico.

---

## 6. Objetivos específicos

Fynar debe permitir:

- registrar ingresos;
- registrar gastos;
- registrar transferencias;
- administrar efectivo y cuentas bancarias;
- administrar billeteras digitales;
- administrar tarjetas de crédito;
- administrar préstamos y deudas;
- crear categorías personalizadas;
- crear presupuestos;
- crear metas de ahorro;
- consultar historial y reportes;
- analizar hábitos financieros;
- detectar gastos repetitivos;
- predecir gastos e ingresos futuros;
- estimar liquidez;
- simular decisiones financieras;
- saber cuándo se terminará de pagar una deuda;
- recibir recomendaciones inteligentes;
- sincronizar la información entre web y móvil.

---

## 7. Principios de producto y experiencia de usuario

### 7.1 Rapidez

Registrar un movimiento debe tomar idealmente menos de cinco segundos.

El flujo mínimo para un gasto debería requerir:

1. valor;
2. categoría;
3. cuenta;
4. guardar.

La inteligencia puede completar o sugerir:

- descripción;
- comercio;
- categoría;
- etiquetas;
- recurrencia.

### 7.2 Claridad

Cada pantalla debe responder una pregunta concreta. El usuario no debería preguntarse dónde está una funcionalidad o qué significa un indicador.

### 7.3 Información accionable

No basta con mostrar números. La interfaz debe explicar:

- qué está pasando;
- por qué está pasando;
- qué podría hacer el usuario.

### 7.4 Consistencia

Web y móvil deben compartir:

- conceptos;
- estados;
- nombres de campos;
- reglas de negocio;
- colores semánticos;
- comportamiento de formularios;
- formato de errores;
- estructura de respuestas de la API.

### 7.5 Accesibilidad

Se debe considerar:

- contraste suficiente;
- navegación mediante teclado en web;
- etiquetas accesibles;
- compatibilidad con lectores de pantalla;
- tamaños adecuados;
- no depender únicamente del color para comunicar estados.

### 7.6 Rendimiento percibido

La aplicación debe utilizar, según corresponda:

- caché local;
- skeleton loaders;
- carga diferida;
- consultas paginadas;
- actualizaciones optimistas controladas;
- sincronización en segundo plano;
- WebSockets para cambios relevantes.

---

## 8. Alcance del MVP

El MVP debe concentrarse en una experiencia financiera personal funcional y confiable.

### 8.1 Autenticación

- registro;
- inicio de sesión;
- cierre de sesión;
- recuperación de contraseña;
- verificación de correo cuando se implemente;
- access token y refresh token;
- sesiones por dispositivo.

### 8.2 Dashboard

Debe mostrar como mínimo:

- dinero disponible;
- ingresos del mes;
- gastos del mes;
- últimos movimientos;
- resumen de cuentas;
- presupuesto usado cuando ya exista información.

### 8.3 Cuentas financieras

El usuario podrá:

- crear cuentas;
- editar cuentas;
- desactivar o eliminar lógicamente cuentas;
- consultar saldos;
- consultar movimientos asociados.

Ejemplos:

- efectivo;
- Bancolombia;
- Nequi;
- Daviplata;
- cuenta de ahorros;
- tarjeta de crédito.

### 8.4 Categorías

El usuario podrá:

- usar categorías globales del sistema;
- crear categorías propias;
- editar categorías propias;
- desactivar o eliminar lógicamente categorías propias;
- asignar icono, color y tipo.

### 8.5 Movimientos

Se deben soportar inicialmente:

- ingresos;
- gastos;
- transferencias;
- ajustes básicos si son necesarios para conciliación.

Cada movimiento debe poder incluir:

- valor;
- fecha;
- cuenta;
- cuenta destino cuando sea transferencia;
- categoría;
- descripción;
- notas;
- comercio;
- comprobante en una etapa posterior del MVP.

### 8.6 Historial

Debe incluir:

- listado paginado;
- búsqueda;
- filtros;
- edición;
- eliminación lógica;
- orden por fecha;
- detalle del movimiento.

### 8.7 Presupuestos simples

- crear presupuesto mensual;
- asociarlo a una o varias categorías;
- mostrar presupuestado;
- mostrar gastado;
- mostrar disponible;
- mostrar porcentaje usado;
- alertar al alcanzar un umbral.

### 8.8 Reportes básicos

- gastos por categoría;
- gastos por mes;
- ingresos frente a gastos;
- evolución básica del saldo.

### 8.9 Sincronización

La misma cuenta debe funcionar en:

- aplicación web;
- aplicación Android;
- iOS en una etapa posterior.

Los cambios deben reflejarse entre clientes sin duplicar reglas financieras en cada frontend.

---

## 9. Funcionalidades posteriores al MVP

Las siguientes funcionalidades forman parte de la visión, pero no deben introducir complejidad innecesaria en la primera entrega.

### 9.1 Deudas y créditos inteligentes

- plan de pagos;
- capital pagado;
- intereses pagados;
- costo total del crédito;
- saldo pendiente;
- fecha estimada de finalización;
- abonos extraordinarios;
- simulación de ahorro por abono;
- estrategia de pago de deudas.

### 9.2 Metas de ahorro

- valor objetivo;
- valor ahorrado;
- fecha objetivo;
- aportes;
- porcentaje de progreso;
- estimación de cumplimiento.

### 9.3 Calendario financiero

- pagos de servicios;
- cuotas de préstamos;
- pagos de tarjetas;
- ingresos esperados;
- gastos programados;
- metas;
- recordatorios.

### 9.4 Inteligencia financiera

- clasificación automática de movimientos;
- detección de suscripciones y gastos repetitivos;
- análisis de hábitos;
- detección de anomalías;
- pronóstico de ingresos y gastos;
- proyección de liquidez;
- simulaciones “qué pasaría si…”;
- recomendaciones personalizadas;
- análisis de riesgo de atraso;
- puntaje de salud financiera.

### 9.5 Roles futuros

- administrador de plataforma;
- contador;
- asesor financiero;
- miembro familiar;
- usuario de solo lectura;
- usuarios empresariales.

---

## 10. Usuarios, espacios y permisos

### 10.1 Usuario personal

Es el usuario principal del MVP. Administra sus propias finanzas dentro de un espacio financiero personal.

### 10.2 Workspace

Un `workspace` es la unidad de aislamiento financiero del sistema.

Toda información financiera debe pertenecer a un workspace, por ejemplo:

- cuentas;
- movimientos;
- presupuestos;
- deudas;
- metas;
- eventos;
- pronósticos;
- reglas de categorización.

Al registrar un usuario se debe crear, dentro de una misma operación transaccional:

1. el usuario;
2. un workspace tipo `PERSONAL`;
3. la membresía del usuario como `OWNER`;
4. las preferencias iniciales;
5. las categorías iniciales que correspondan.

Ejemplo:

```text
Usuario: Maycol
Workspace: Finanzas de Maycol
Tipo: PERSONAL
Moneda: COP
Zona horaria: America/Bogota
Rol: OWNER
```

### 10.3 RBAC

El sistema usa control de acceso basado en roles y permisos.

Roles base:

- `OWNER`;
- `ADMIN`;
- `MEMBER`;
- `VIEWER`;
- `ACCOUNTANT`;
- `ADVISOR`.

Permisos base:

- `workspace.manage`;
- `members.manage`;
- `accounts.read`;
- `accounts.write`;
- `transactions.read`;
- `transactions.write`;
- `budgets.read`;
- `budgets.write`;
- `debts.read`;
- `debts.write`;
- `reports.read`;
- `ai.use`.

En el MVP se utilizará principalmente `OWNER`, pero el código no debe asumir que siempre existirá un único rol.

---

## 11. Stack tecnológico definido

### Backend

- Node.js LTS;
- Express;
- TypeScript estricto con ES Modules;
- compilación mediante `tsc` y ejecución de desarrollo mediante `tsx`;
- API REST;
- PostgreSQL;
- Prisma ORM;
- JWT para access tokens;
- refresh tokens almacenados mediante hash;
- WebSockets en sincronización futura;
- Redis para caché, colas y rate limiting en fases posteriores.

### Frontend web

- React 19;
- TypeScript;
- Vite;
- Bootstrap;
- CSS Modules cuando sea necesario;
- shadcn/ui;
- Radix UI;
- Recharts;
- Zustand;
- TanStack Query;
- React Hook Form;
- Zod.

### Aplicación móvil

- React Native;
- Expo;
- TypeScript;
- Expo Router;
- Zustand;
- TanStack Query;
- MMKV;
- Expo Notifications.

### Infraestructura prevista

- Docker;
- Render o Railway para el backend del MVP;
- PostgreSQL administrado en Neon o Supabase;
- Vercel para la web;
- Expo EAS Build para móvil;
- GitHub y GitHub Actions;
- Sentry para errores;
- OpenTelemetry, Prometheus y Grafana en etapas posteriores.

---

## 12. Arquitectura del backend

Fynar comienza como un **monolito modular**.

Esto significa:

- una sola aplicación backend desplegable;
- una sola base de datos principal;
- módulos separados por responsabilidad;
- reglas de negocio encapsuladas;
- posibilidad futura de extraer servicios independientes.

No se deben crear microservicios prematuramente.

### 12.1 Flujo general

```text
Aplicación web / Aplicación móvil
                |
                v
          HTTPS / REST API
                |
                v
          Backend Express
                |
      +---------+----------+
      |         |          |
      v         v          v
 PostgreSQL   Redis       Motor IA
```

### 12.2 Separación de responsabilidades

- **Rutas:** declaran endpoints y middlewares aplicables.
- **Controladores:** reciben la petición, invocan el caso de uso y construyen la respuesta HTTP.
- **Servicios:** contienen reglas de negocio y coordinan operaciones.
- **Repositorios:** encapsulan consultas y persistencia.
- **Validadores:** validan parámetros, cuerpo y query string.
- **DTOs:** definen la forma de entrada y salida.
- **Entidades/modelos de dominio:** representan conceptos y reglas centrales cuando resulte útil.
- **Middlewares:** resuelven preocupaciones transversales como autenticación, permisos, errores y trazabilidad.

Los controladores no deben contener consultas SQL directas ni reglas financieras complejas.

### 12.3 Estructura de carpetas

```text
fynar-backend/
├── src/
│   ├── config/
│   ├── common/
│   │   ├── constants/
│   │   ├── errors/
│   │   ├── helpers/
│   │   ├── middlewares/
│   │   ├── types/
│   │   └── utils/
│   ├── database/
│   │   ├── migrations/
│   │   ├── seeds/
│   │   └── prisma/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── workspaces/
│   │   ├── accounts/
│   │   ├── categories/
│   │   ├── transactions/
│   │   ├── budgets/
│   │   ├── debts/
│   │   ├── savings-goals/
│   │   ├── financial-events/
│   │   ├── dashboard/
│   │   ├── reports/
│   │   ├── notifications/
│   │   └── ai/
│   ├── routes/
│   ├── app.js
│   └── server.js
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env
├── .gitignore
├── package.json
└── package-lock.json
```

Cuando se implemente un módulo, su estructura esperada será similar a:

```text
modules/accounts/
├── controllers/
├── services/
├── repositories/
├── routes/
├── validators/
├── dtos/
├── entities/
└── types/
```

No es obligatorio crear archivos vacíos antes de necesitarlos.

---

## 13. Convenciones de backend

### 13.1 Nombres

- carpetas y archivos: `kebab-case`;
- variables y funciones: `camelCase`;
- clases: `PascalCase`;
- constantes: `UPPER_SNAKE_CASE`;
- tablas y columnas: `snake_case`;
- endpoints: sustantivos plurales en minúscula.

Ejemplos:

```text
src/modules/financial-events/
account.controller.js
createAccountService
AccountRepository
MAX_LOGIN_ATTEMPTS
financial_accounts
/api/v1/accounts
```

### 13.2 API

Prefijo recomendado:

```text
/api/v1
```

Ejemplos:

```text
GET    /api/v1/accounts
POST   /api/v1/accounts
GET    /api/v1/accounts/:accountId
PATCH  /api/v1/accounts/:accountId
DELETE /api/v1/accounts/:accountId
```

### 13.3 Respuesta exitosa

Formato recomendado:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

### 13.4 Respuesta de error

Formato recomendado:

```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "La cuenta solicitada no existe.",
    "details": []
  },
  "requestId": "uuid"
}
```

No se deben enviar stack traces al cliente en producción.

### 13.5 Eliminación lógica

Las tablas que incluyen `deleted_at` deben usar eliminación lógica de manera predeterminada.

Una consulta normal no debe retornar registros eliminados.

### 13.6 Fechas y zonas horarias

- almacenar instantes en `TIMESTAMPTZ`;
- usar UTC internamente;
- presentar fechas según la zona horaria del workspace o usuario;
- valor inicial: `America/Bogota`;
- no construir fechas financieras usando cadenas ambiguas.

### 13.7 Dinero

- usar `NUMERIC(18,2)` en PostgreSQL;
- no usar `float` para cálculos monetarios;
- usar librerías o tipos decimales compatibles con Prisma;
- la moneda debe representarse mediante código ISO de tres caracteres;
- moneda inicial: `COP`.

### 13.8 Transacciones de base de datos

Toda operación que modifique múltiples agregados relacionados debe ejecutarse en una transacción.

Ejemplos:

- registro de usuario + workspace + membresía + preferencias;
- creación de una transferencia + actualización de dos saldos + evento outbox;
- pago de deuda + transacción financiera + actualización de cuota + actualización de saldo de deuda;
- aporte a meta + transacción + actualización de progreso.

---

## 14. Modelo de datos

La base inicial contiene **33 tablas** agrupadas por responsabilidad.

### 14.1 Identidad, autenticación y autorización

1. `users`
2. `auth_identities`
3. `refresh_tokens`
4. `roles`
5. `permissions`
6. `role_permissions`

### 14.2 Espacios financieros y preferencias

7. `workspaces`
8. `workspace_members`
9. `user_preferences`

### 14.3 Cuentas y categorías

10. `financial_accounts`
11. `categories`

### 14.4 Movimientos

12. `recurrence_rules`
13. `transactions`
14. `transaction_splits`
15. `transaction_attachments`
16. `account_balance_snapshots`

### 14.5 Presupuestos

17. `budgets`
18. `budget_categories`
19. `budget_accounts`

### 14.6 Deudas y créditos

20. `debts`
21. `debt_installments`
22. `debt_payments`

### 14.7 Metas y calendario

23. `savings_goals`
24. `goal_contributions`
25. `financial_events`

### 14.8 Inteligencia financiera

26. `merchant_category_rules`
27. `ai_insights`
28. `forecasts`
29. `financial_simulations`

### 14.9 Notificaciones, auditoría y sincronización

30. `notifications`
31. `device_tokens`
32. `audit_logs`
33. `outbox_events`

---

## 15. Diagrama relacional resumido

```mermaid
erDiagram
    users ||--o{ auth_identities : has
    users ||--o{ refresh_tokens : owns
    users ||--o{ workspaces : creates
    users ||--o{ workspace_members : belongs
    users ||--|| user_preferences : configures
    users ||--o{ transactions : creates
    users ||--o{ notifications : receives
    users ||--o{ device_tokens : registers
    users ||--o{ audit_logs : performs
    users ||--o{ financial_simulations : creates

    roles ||--o{ workspace_members : assigned
    roles ||--o{ role_permissions : has
    permissions ||--o{ role_permissions : grants

    workspaces ||--o{ workspace_members : contains
    workspaces ||--o{ financial_accounts : owns
    workspaces ||--o{ categories : owns
    workspaces ||--o{ recurrence_rules : owns
    workspaces ||--o{ transactions : owns
    workspaces ||--o{ budgets : owns
    workspaces ||--o{ debts : owns
    workspaces ||--o{ savings_goals : owns
    workspaces ||--o{ financial_events : owns
    workspaces ||--o{ merchant_category_rules : learns
    workspaces ||--o{ ai_insights : receives
    workspaces ||--o{ forecasts : receives
    workspaces ||--o{ financial_simulations : stores
    workspaces ||--o{ notifications : scopes
    workspaces ||--o{ audit_logs : records
    workspaces ||--o{ outbox_events : emits

    categories ||--o{ categories : parent_of
    categories ||--o{ transactions : classifies
    categories ||--o{ transaction_splits : classifies
    categories ||--o{ budget_categories : limits
    categories ||--o{ merchant_category_rules : maps

    financial_accounts ||--o{ transactions : source_account
    financial_accounts ||--o{ transactions : destination_account
    financial_accounts ||--o{ account_balance_snapshots : snapshots
    financial_accounts ||--o{ budget_accounts : limits
    financial_accounts ||--o{ debts : liability_account
    financial_accounts ||--o{ savings_goals : holds

    recurrence_rules ||--o{ transactions : repeats
    recurrence_rules ||--o{ financial_events : repeats

    transactions ||--o{ transactions : parent_of
    transactions ||--o{ transaction_splits : divides
    transactions ||--o{ transaction_attachments : attaches
    transactions ||--o| debt_payments : supports
    transactions ||--o{ goal_contributions : supports
    transactions ||--o{ financial_events : relates

    budgets ||--o{ budget_categories : includes
    budgets ||--o{ budget_accounts : includes

    debts ||--o{ debt_installments : schedules
    debts ||--o{ debt_payments : receives
    debts ||--o{ financial_events : schedules
    debt_installments ||--o{ debt_payments : receives

    savings_goals ||--o{ goal_contributions : receives
    savings_goals ||--o{ financial_events : schedules
```

Este diagrama es resumido. La fuente definitiva de tipos, restricciones, nulabilidad y reglas `ON DELETE` es la migración o esquema SQL vigente.

---

## 16. Explicación tabla por tabla

### 16.1 `users`

Almacena la identidad principal del usuario.

Campos relevantes:

- `id`: UUID;
- `email`: correo único, tipo `CITEXT` para comparación sin distinción de mayúsculas;
- `password_hash`: hash de la contraseña local;
- `first_name` y `last_name`;
- `phone`;
- `avatar_url`;
- `is_email_verified`;
- `is_active`;
- `last_login_at`;
- `created_at`, `updated_at`, `deleted_at`.

Reglas:

- nunca almacenar contraseñas en texto plano;
- `deleted_at` representa eliminación lógica;
- la información financiera no vive directamente en esta tabla;
- un usuario puede pertenecer a varios workspaces.

Relaciones:

- uno a muchos con `auth_identities`;
- uno a muchos con `refresh_tokens`;
- uno a muchos con `workspace_members`;
- uno a uno con `user_preferences`;
- uno a muchos con `transactions` mediante `created_by`;
- uno a muchos con `notifications`, `device_tokens` y `financial_simulations`.

### 16.2 `auth_identities`

Permite iniciar sesión mediante distintos proveedores.

Proveedores iniciales:

- `LOCAL`;
- `GOOGLE`;
- `APPLE`.

Relación:

- cada identidad pertenece a un `user`;
- un usuario solo puede tener una identidad por proveedor;
- la pareja proveedor + identificador externo es única.

Esta tabla permite agregar OAuth sin llenar `users` de columnas específicas de cada proveedor.

### 16.3 `refresh_tokens`

Representa sesiones renovables por dispositivo.

Almacena:

- hash del token;
- usuario;
- nombre del dispositivo;
- dirección IP;
- user agent;
- vencimiento;
- revocación.

Reglas:

- guardar únicamente el hash del refresh token;
- permitir revocar una sesión concreta;
- permitir revocar todas las sesiones del usuario;
- los access tokens deben tener vida corta.

### 16.4 `roles`

Define roles disponibles dentro de los workspaces.

Roles base:

- `OWNER`;
- `ADMIN`;
- `MEMBER`;
- `VIEWER`;
- `ACCOUNTANT`;
- `ADVISOR`.

### 16.5 `permissions`

Define acciones atómicas del sistema.

Los servicios deben verificar permisos, no solamente nombres de roles.

### 16.6 `role_permissions`

Tabla puente entre roles y permisos.

Clave primaria compuesta:

```text
(role_id, permission_id)
```

### 16.7 `workspaces`

Es la unidad principal de aislamiento financiero.

Campos relevantes:

- nombre;
- tipo: `PERSONAL`, `FAMILY` o `BUSINESS`;
- moneda base;
- zona horaria;
- propietario original;
- estado;
- eliminación lógica.

Regla crítica:

> Toda consulta financiera debe estar limitada por un `workspace_id` autorizado.

Nunca se debe aceptar un `workspace_id` del cliente y usarlo sin verificar la membresía y el permiso del usuario autenticado.

### 16.8 `workspace_members`

Relaciona usuarios con workspaces y roles.

Clave primaria compuesta:

```text
(workspace_id, user_id)
```

Estados:

- `INVITED`;
- `ACTIVE`;
- `SUSPENDED`.

Permite en el futuro compartir finanzas familiares y autorizar contadores o asesores.

### 16.9 `user_preferences`

Almacena preferencias personales:

- workspace predeterminado;
- idioma;
- moneda;
- zona horaria;
- formato de fecha;
- tema;
- pantalla inicial;
- diseño del dashboard en JSONB.

No se debe confundir la moneda preferida para presentación con la moneda real de cada cuenta o movimiento.

### 16.10 `financial_accounts`

Representa dónde existe dinero o una obligación.

Tipos:

- `CASH`;
- `CHECKING`;
- `SAVINGS`;
- `E_WALLET`;
- `CREDIT_CARD`;
- `INVESTMENT`;
- `LOAN`;
- `OTHER`.

Naturaleza:

- `ASSET`: dinero o activo del usuario;
- `LIABILITY`: obligación del usuario.

Campos relevantes:

- saldo inicial;
- saldo actual;
- institución;
- moneda;
- cupo de crédito;
- día de corte;
- día de pago;
- icono y color;
- favorito;
- inclusión en patrimonio.

Reglas críticas:

- `current_balance` es un valor de consulta rápida, no una fuente aislada de verdad;
- debe poder reconstruirse a partir de saldo inicial y movimientos;
- no debe ser modificado directamente por el frontend;
- los días de corte y pago deben estar entre 1 y 31;
- el nombre es único dentro de cada workspace según el esquema inicial.

### 16.11 `categories`

Clasifica movimientos.

Tipos:

- `INCOME`;
- `EXPENSE`;
- `TRANSFER`;
- `INVESTMENT`.

Puede representar subcategorías mediante `parent_id`.

Las categorías pueden ser:

- globales: `workspace_id = NULL`;
- personalizadas: asociadas a un workspace.

Ejemplo:

```text
Alimentación
├── Restaurantes
├── Mercado
└── Domicilios
```

### 16.12 `recurrence_rules`

Define recurrencias de movimientos o eventos.

Frecuencias:

- diaria;
- semanal;
- mensual;
- anual.

Campos principales:

- intervalo;
- día de semana;
- día de mes;
- inicio;
- finalización;
- próxima ejecución;
- estado.

No debe confundirse una regla recurrente con una transacción confirmada. La regla puede generar eventos o movimientos cuando corresponda.

### 16.13 `transactions`

Es la tabla financiera central.

Tipos:

- `INCOME`;
- `EXPENSE`;
- `TRANSFER`;
- `INVESTMENT`;
- `DEBT_PAYMENT`;
- `ADJUSTMENT`;
- `REFUND`.

Estados:

- `PENDING`;
- `CONFIRMED`;
- `CANCELLED`.

Campos relevantes:

- workspace;
- monto y moneda;
- cuenta origen;
- cuenta destino;
- categoría;
- regla recurrente;
- transacción padre;
- fecha efectiva;
- descripción;
- notas;
- comercio;
- ubicación;
- categorización por IA;
- referencia externa;
- metadatos;
- versión para concurrencia optimista;
- creador.

Reglas críticas:

- el monto siempre es positivo;
- el tipo determina cómo impacta saldos;
- una transferencia requiere cuenta origen y destino diferentes;
- una operación distinta de transferencia requiere cuenta origen;
- todas las cuentas y categorías utilizadas deben pertenecer al mismo workspace o ser categorías globales permitidas;
- `version` debe usarse para evitar sobrescrituras concurrentes;
- eliminar o cancelar una transacción debe revertir consistentemente sus efectos financieros;
- nunca actualizar un saldo sin registrar o ajustar el movimiento que explica el cambio.

### 16.14 `transaction_splits`

Permite dividir un movimiento en varias categorías.

Ejemplo:

```text
Compra total: 200.000
- Alimentación: 150.000
- Aseo: 30.000
- Mascotas: 20.000
```

Regla crítica:

- la suma de divisiones debe coincidir con el monto de la transacción cuando se utilicen splits completos.

En el MVP se puede utilizar una categoría directa en `transactions` y posponer la interfaz de divisiones.

### 16.15 `transaction_attachments`

Almacena metadatos de comprobantes o facturas.

No almacena el binario en PostgreSQL.

Almacena:

- clave del archivo en storage;
- nombre;
- MIME type;
- tamaño;
- usuario que cargó el archivo.

El archivo puede vivir en Supabase Storage, S3, Cloudflare R2 u otro proveedor.

### 16.16 `account_balance_snapshots`

Guarda fotografías históricas del saldo de una cuenta.

Usos:

- gráficas históricas;
- evolución patrimonial;
- conciliación;
- pronósticos;
- detección de inconsistencias.

No reemplaza los movimientos.

### 16.17 `budgets`

Representa un presupuesto para un periodo.

Periodos:

- semanal;
- mensual;
- anual;
- personalizado.

Campos relevantes:

- fechas;
- monto;
- umbral de alerta;
- rollover;
- estado.

Reglas:

- el valor gastado se calcula desde los movimientos;
- no debe guardarse como verdad permanente sin posibilidad de reconciliación;
- la fecha final no puede ser anterior a la inicial.

### 16.18 `budget_categories`

Relaciona un presupuesto con categorías.

Puede incluir un monto asignado específico por categoría.

### 16.19 `budget_accounts`

Relaciona un presupuesto con cuentas específicas.

Permite presupuestos por:

- categoría;
- cuenta;
- periodo;
- combinación de cuenta y categoría.

### 16.20 `debts`

Representa la información general de una deuda.

Tipos:

- préstamo personal;
- préstamo bancario;
- tarjeta de crédito;
- hipoteca;
- crédito de vehículo;
- crédito educativo;
- otro.

Campos relevantes:

- entidad;
- monto original;
- saldo actual;
- tasa anual;
- tipo de interés;
- plazo;
- cuota;
- desembolso;
- primer pago;
- día de pago;
- fecha estimada de finalización;
- cuenta pasiva relacionada.

Reglas:

- el saldo actual no puede ser negativo;
- una deuda puede asociarse a una cuenta de naturaleza `LIABILITY`;
- los pagos reales deben quedar representados también como movimientos financieros.

### 16.21 `debt_installments`

Contiene el cronograma de cuotas.

Cada cuota incluye:

- número;
- vencimiento;
- saldo inicial;
- capital;
- interés;
- seguro;
- comisiones;
- total;
- pagado;
- saldo final;
- estado;
- fecha de pago.

Estados:

- `PENDING`;
- `PARTIAL`;
- `PAID`;
- `OVERDUE`;
- `CANCELLED`.

La pareja deuda + número de cuota es única.

### 16.22 `debt_payments`

Registra cada pago real de una deuda.

Relaciona:

- deuda;
- cuota opcional;
- transacción financiera obligatoria;
- capital;
- interés;
- seguro;
- comisiones;
- abono extraordinario.

Regla crítica:

> Un pago de deuda no debe duplicar la salida de dinero. `transactions` representa la salida y `debt_payments` representa su distribución financiera.

La relación con `transactions` es única.

### 16.23 `savings_goals`

Representa una meta de ahorro.

Campos:

- nombre;
- valor objetivo;
- valor ahorrado;
- fecha objetivo;
- cuenta asociada;
- estado;
- icono y color.

`saved_amount` puede funcionar como caché, pero debe poder validarse con los aportes.

### 16.24 `goal_contributions`

Registra aportes a metas.

Puede vincularse a una transacción financiera.

Debe evitarse contabilizar dos veces el mismo movimiento.

### 16.25 `financial_events`

Alimenta el calendario financiero.

Tipos:

- ingreso;
- gasto;
- pago de deuda;
- pago de tarjeta;
- meta de ahorro;
- recordatorio;
- otro.

Puede relacionarse con:

- recurrencia;
- transacción;
- deuda;
- meta.

Un evento futuro no debe afectar el saldo hasta convertirse en una transacción confirmada.

### 16.26 `merchant_category_rules`

Almacena reglas aprendidas de comercio a categoría.

Ejemplos:

- McDonald's → Alimentación;
- Terpel → Gasolina;
- Claro → Servicios.

La aplicación debe consultar estas reglas antes de depender de un modelo externo, reduciendo costo y latencia.

### 16.27 `ai_insights`

Almacena hallazgos y recomendaciones.

Tipos:

- clasificación;
- patrón de gasto;
- riesgo de liquidez;
- pronóstico;
- recomendación;
- anomalía.

Incluye:

- severidad;
- confianza;
- datos estructurados;
- vigencia;
- lectura;
- descarte;
- versión del modelo.

Los insights deben ser explicables y basarse en datos autorizados del workspace.

### 16.28 `forecasts`

Almacena pronósticos numéricos.

Tipos:

- flujo de caja;
- gastos;
- ingresos;
- ahorro;
- patrimonio;
- liquidez.

Incluye:

- periodo;
- valor proyectado;
- límites inferior y superior;
- confianza;
- supuestos;
- versión del modelo.

Los pronósticos no sustituyen saldos reales.

### 16.29 `financial_simulations`

Almacena escenarios de tipo “qué pasaría si…”.

Ejemplo de entrada:

```json
{
  "purchaseAmount": 4500000,
  "paymentMethod": "CREDIT",
  "installments": 12,
  "monthlyRate": 0.018
}
```

Ejemplo de resultado:

```json
{
  "monthlyPayment": 425000,
  "liquidityRisk": true,
  "affectedBudgets": ["Ahorro", "Entretenimiento"],
  "estimatedRecoveryMonths": 6
}
```

Regla crítica:

- una simulación nunca modifica saldos, movimientos o presupuestos reales.

### 16.30 `notifications`

Almacena alertas para un usuario.

Tipos:

- presupuesto próximo a agotarse;
- pago próximo;
- riesgo de liquidez;
- gasto inusual;
- disminución de ingresos;
- progreso de meta;
- sistema.

Permite sincronizar el estado leído entre web y móvil.

### 16.31 `device_tokens`

Almacena tokens de notificaciones push por dispositivo.

Un usuario puede tener varios dispositivos.

Los tokens deben poder desactivarse sin eliminar el usuario.

### 16.32 `audit_logs`

Registra cambios sensibles.

Debe incluir según disponibilidad:

- workspace;
- usuario;
- entidad;
- identificador;
- acción;
- valores anteriores;
- valores nuevos;
- IP;
- user agent;
- fecha.

No es necesario auditar todas las lecturas. Deben priorizarse escrituras y acciones sensibles.

### 16.33 `outbox_events`

Implementa el patrón Transactional Outbox.

Cuando una operación de negocio se confirma, el backend puede guardar en la misma transacción:

```text
Movimiento financiero
+
Evento transaction.created
```

Después, un procesador puede:

- emitir WebSocket;
- recalcular presupuestos;
- generar notificaciones;
- ejecutar análisis de IA;
- actualizar reportes;
- procesar sincronización.

Esto evita perder eventos si la operación principal se guardó pero un servicio secundario falló.

---

## 17. Enumeraciones de base de datos

```text
workspace_type:
  PERSONAL | FAMILY | BUSINESS

member_status:
  INVITED | ACTIVE | SUSPENDED

account_type:
  CASH | CHECKING | SAVINGS | E_WALLET | CREDIT_CARD |
  INVESTMENT | LOAN | OTHER

account_nature:
  ASSET | LIABILITY

category_type:
  INCOME | EXPENSE | TRANSFER | INVESTMENT

transaction_type:
  INCOME | EXPENSE | TRANSFER | INVESTMENT |
  DEBT_PAYMENT | ADJUSTMENT | REFUND

transaction_status:
  PENDING | CONFIRMED | CANCELLED

recurrence_frequency:
  DAILY | WEEKLY | MONTHLY | YEARLY

budget_period:
  WEEKLY | MONTHLY | YEARLY | CUSTOM

debt_type:
  PERSONAL_LOAN | BANK_LOAN | CREDIT_CARD | MORTGAGE |
  VEHICLE_LOAN | EDUCATION_LOAN | OTHER

debt_status:
  ACTIVE | PAID | PAUSED | DEFAULTED | CANCELLED

interest_type:
  FIXED | VARIABLE | NONE

installment_status:
  PENDING | PARTIAL | PAID | OVERDUE | CANCELLED

goal_status:
  ACTIVE | COMPLETED | PAUSED | CANCELLED

event_type:
  INCOME | EXPENSE | DEBT_PAYMENT | CARD_PAYMENT |
  SAVINGS_GOAL | REMINDER | OTHER

notification_type:
  BUDGET_ALERT | PAYMENT_DUE | LIQUIDITY_RISK |
  UNUSUAL_SPENDING | INCOME_DROP | GOAL_PROGRESS | SYSTEM

insight_type:
  CLASSIFICATION | SPENDING_PATTERN | LIQUIDITY_RISK |
  FORECAST | RECOMMENDATION | ANOMALY

forecast_type:
  CASH_FLOW | EXPENSES | INCOME | SAVINGS | NET_WORTH | LIQUIDITY

provider_type:
  LOCAL | GOOGLE | APPLE
```

---

## 18. Reglas financieras críticas

### 18.1 Integridad por workspace

- todas las entidades financieras deben permanecer dentro del workspace correcto;
- no se puede asociar una cuenta de un workspace a un movimiento de otro;
- no se puede consultar información de un workspace sin membresía activa;
- toda acción debe validar permisos.

### 18.2 Impacto de movimientos

La aplicación debe definir de manera centralizada el impacto de cada tipo:

- ingreso: aumenta saldo de cuenta activa;
- gasto: disminuye saldo de cuenta activa;
- transferencia: disminuye origen y aumenta destino;
- pago de deuda: disminuye cuenta activa y reduce obligación;
- reembolso: revierte total o parcialmente un gasto según referencia;
- ajuste: debe requerir motivo y auditoría.

No se deben replicar estas reglas en controladores, frontend y tareas. Debe existir una fuente de verdad en servicios de dominio.

### 18.3 Saldos

`current_balance` es una optimización.

Debe existir una estrategia para:

- recalcularlo;
- verificarlo;
- detectar inconsistencias;
- reconstruirlo desde movimientos confirmados;
- conservar snapshots cuando corresponda.

### 18.4 Concurrencia

La columna `transactions.version` está destinada a control de concurrencia optimista.

Ejemplo:

1. web lee versión 4;
2. móvil actualiza y genera versión 5;
3. web intenta guardar todavía con versión 4;
4. el backend rechaza la escritura con conflicto `409`.

### 18.5 Idempotencia

Las operaciones sensibles deben aceptar o generar claves de idempotencia cuando exista riesgo de repetición, especialmente:

- creación de movimientos desde móvil;
- pagos;
- webhooks;
- procesos en segundo plano;
- reintentos de sincronización.

### 18.6 Auditoría

Deben auditarse como mínimo:

- cambios de permisos;
- cambios de membresías;
- modificaciones o eliminaciones de movimientos;
- ajustes manuales de saldos;
- cambios de deuda;
- acciones administrativas;
- revocación de sesiones cuando sea relevante.

---

## 19. Seguridad

### 19.1 Contraseñas

- usar Argon2id o bcrypt con configuración segura;
- nunca registrar contraseñas;
- nunca retornar `password_hash`;
- aplicar políticas razonables sin imponer reglas arbitrariamente complejas;
- usar recuperación mediante token de un solo uso y vencimiento corto.

### 19.2 JWT y sesiones

- access token de duración corta;
- refresh token rotativo;
- almacenar el hash del refresh token;
- detectar reutilización cuando se implemente rotación;
- permitir revocar por dispositivo;
- no guardar secretos en el repositorio.

### 19.3 Autorización

Cada endpoint financiero debe validar:

1. autenticación;
2. membresía activa en el workspace;
3. permiso necesario;
4. pertenencia de los recursos utilizados.

### 19.4 Validación

- no confiar en datos del frontend;
- validar body, params y query;
- rechazar campos desconocidos cuando sea conveniente;
- normalizar correo y entradas textuales;
- limitar tamaño de payload;
- validar tipos MIME y tamaño de archivos.

### 19.5 Protección HTTP

- Helmet;
- CORS restringido por ambiente;
- rate limiting;
- request ID;
- logs estructurados;
- sanitización apropiada;
- parámetros SQL gestionados por ORM;
- protección contra fuerza bruta en autenticación.

### 19.6 Privacidad e IA

- enviar a proveedores externos únicamente los datos necesarios;
- evitar enviar identificadores personales innecesarios;
- no usar datos de un workspace para responder preguntas de otro;
- registrar versión del modelo y supuestos;
- diferenciar recomendación educativa de asesoría financiera profesional;
- permitir al usuario descartar insights.

---

## 20. Inteligencia artificial

La IA no debe ser un chatbot aislado sin contexto. Debe actuar sobre información financiera estructurada y autorizada.

### Orden recomendado de decisión

1. reglas deterministas del sistema;
2. reglas aprendidas del usuario;
3. cálculos estadísticos;
4. modelos predictivos;
5. LLM para explicación en lenguaje natural.

### Niveles previstos

1. clasificación automática de movimientos;
2. detección de gastos repetitivos;
3. análisis de hábitos;
4. predicción del próximo mes;
5. predicción de liquidez;
6. simulación financiera;
7. pronóstico de riesgo de créditos;
8. asistente financiero con recomendaciones.

### Reglas para implementaciones de IA

- no inventar movimientos o saldos;
- citar internamente los datos utilizados para producir una recomendación;
- almacenar nivel de confianza cuando corresponda;
- guardar supuestos;
- versionar modelos;
- permitir regeneración;
- evitar que una explicación textual modifique datos reales;
- separar el cálculo del texto explicativo;
- usar reglas locales antes de una llamada externa.

---

## 21. Sincronización y eventos

Cuando se registre un movimiento confirmado, el flujo esperado puede ser:

```text
Validar usuario y workspace
        |
        v
Validar cuenta, categoría y monto
        |
        v
Abrir transacción de base de datos
        |
        +--> Crear movimiento
        +--> Actualizar saldos afectados
        +--> Crear audit log cuando aplique
        +--> Crear outbox event
        |
        v
Confirmar transacción
        |
        v
Procesar evento asíncrono
        |
        +--> Actualizar presupuesto
        +--> Emitir WebSocket
        +--> Crear notificación
        +--> Ejecutar análisis
```

Las tareas secundarias no deben impedir permanentemente el registro financiero si pueden procesarse de forma segura después.

---

## 22. Pruebas

### Unitarias

Deben cubrir reglas como:

- impacto de movimientos en saldos;
- transferencias;
- presupuesto consumido;
- cálculo de cuota y deuda;
- permisos;
- validaciones;
- concurrencia optimista;
- clasificación mediante reglas locales.

### Integración

Deben utilizar PostgreSQL real o una instancia aislada compatible para validar:

- relaciones;
- restricciones;
- transacciones;
- Prisma;
- migraciones;
- repositorios;
- rollback.

### End-to-end

Deben comprobar flujos completos:

- registro;
- inicio de sesión;
- creación de cuenta;
- creación de categoría;
- registro de ingreso;
- registro de gasto;
- transferencia;
- consulta de dashboard;
- aislamiento entre workspaces.

### Regla de calidad

No utilizar mocks para ocultar errores de integridad que solo aparecerían en PostgreSQL.

---

## 23. Observabilidad y registro

Los logs deben ser estructurados y no deben exponer:

- contraseñas;
- access tokens;
- refresh tokens;
- claves API;
- datos financieros completos innecesarios;
- información sensible de proveedores.

Campos útiles:

- timestamp;
- nivel;
- request ID;
- user ID cuando sea seguro;
- workspace ID;
- endpoint;
- duración;
- status code;
- código de error.

Se debe diferenciar:

- error esperado de negocio;
- error de validación;
- error de autorización;
- conflicto de concurrencia;
- error de infraestructura;
- error inesperado.

---

## 24. Variables de entorno previstas

Ejemplo conceptual:

```env
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1

DATABASE_URL=postgresql://...

JWT_ACCESS_SECRET=...
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

CORS_ORIGINS=http://localhost:5173

LOG_LEVEL=debug

REDIS_URL=

OPENAI_API_KEY=

STORAGE_PROVIDER=
STORAGE_BUCKET=
```

Fynar utiliza `.env` para la configuración local; este archivo nunca debe versionarse, adjuntarse ni incluirse en paquetes compartidos. `.env.example` conserva únicamente nombres y valores ficticios para documentar el contrato de configuración y sí forma parte del código fuente.

---

## 25. Orden recomendado de implementación

### Fase 1 — Planeación

1. idea y alcance;
2. MVP;
3. usuarios y funcionalidades;
4. UX;
5. diseño visual.

### Fase 2 — Diseño técnico

6. stack tecnológico;
7. arquitectura;
8. base de datos;
9. contrato de API;
10. organización de repositorios o monorepo.

### Fase 3 — Backend

11. backend base;
12. autenticación;
13. usuarios y workspaces;
14. cuentas;
15. categorías;
16. movimientos;
17. dashboard;
18. presupuestos;
19. reportes básicos.

### Fase 4 — Clientes

20. aplicación web;
21. aplicación móvil.

### Fase 5 — Calidad

22. seguridad;
23. pruebas;
24. rendimiento.

### Fase 6 — Producción

25. backend y base de datos;
26. web;
27. Android;
28. documentación;
29. lanzamiento.

### Fase 7 — Evolución

30. deudas avanzadas;
31. metas;
32. calendario;
33. notificaciones;
34. IA y pronósticos;
35. nuevos roles y espacios;
36. integraciones externas.

---

## 26. Primera fase de desarrollo del backend

La primera fase técnica debe crear una base estable sin implementar prematuramente todo el dominio.

### Entregables iniciales

- servidor Express;
- carga de variables de entorno;
- middleware de seguridad;
- CORS por ambiente;
- logging HTTP;
- manejo centralizado de errores;
- respuesta 404;
- health check;
- estructura modular;
- conexión a PostgreSQL;
- Prisma configurado;
- migración inicial;
- seed de roles y permisos;
- pruebas de arranque y health check.

### No incluir todavía

- IA real;
- Redis obligatorio;
- WebSockets;
- microservicios;
- todas las entidades al mismo tiempo;
- lógica de deuda avanzada;
- almacenamiento de archivos;
- Open Finance.

El desarrollo debe avanzar módulo por módulo, con pruebas y migraciones pequeñas.

---

## 27. Criterios de aceptación globales

Una funcionalidad no se considera terminada solamente porque “funciona” en un caso feliz.

Debe cumplir:

- validación de entrada;
- autorización;
- aislamiento por workspace;
- manejo de errores;
- transacción cuando corresponda;
- logs útiles;
- pruebas;
- documentación del endpoint;
- no romper contratos existentes;
- no duplicar reglas de negocio;
- no exponer datos sensibles;
- mantener consistencia de saldos.

---

## 28. Instrucciones obligatorias para asistentes de IA y Codex

Antes de escribir código, el asistente debe:

1. leer este README completo;
2. identificar el módulo afectado;
3. revisar las tablas y relaciones relacionadas;
4. revisar si la funcionalidad pertenece al MVP o a una fase futura;
5. localizar código existente antes de crear archivos nuevos;
6. evitar duplicar controladores, servicios, utilidades o modelos;
7. explicar cualquier cambio de arquitectura;
8. preservar compatibilidad salvo autorización explícita;
9. crear o actualizar pruebas;
10. indicar migraciones necesarias;
11. advertir impactos en seguridad, saldos, permisos y sincronización.

### El asistente no debe

- cambiar el stack sin autorización;
- reemplazar Express por otro framework;
- introducir microservicios sin necesidad demostrada;
- crear tablas duplicadas;
- modificar el esquema directamente en producción;
- eliminar datos sin migración y respaldo;
- poner lógica financiera en controladores;
- confiar en `workspace_id` sin autorización;
- modificar `current_balance` desde el frontend;
- almacenar contraseñas o tokens sin hash;
- usar `float` para dinero;
- inventar campos que contradigan el esquema;
- implementar funcionalidades futuras como requisito del MVP sin aprobación;
- omitir pruebas por considerar el cambio “pequeño”.

### Formato esperado al proponer cambios

Toda propuesta importante debe indicar:

```text
Objetivo
Archivos afectados
Tablas afectadas
Endpoints afectados
Reglas de negocio involucradas
Riesgos
Migración requerida
Pruebas requeridas
Compatibilidad
```

### Regla de decisión

Cuando falte información, el asistente debe hacer una pregunta concreta o presentar opciones con sus consecuencias. No debe asumir silenciosamente una decisión que afecte arquitectura, dinero, seguridad o datos.

---

## 29. Ejemplo de solicitud para Codex

```text
Lee primero el README.md completo y úsalo como fuente principal del proyecto.

Tarea:
Implementar el módulo de cuentas financieras.

Antes de modificar archivos:
1. analiza la estructura existente;
2. identifica las tablas y reglas implicadas;
3. presenta un plan corto;
4. señala migraciones necesarias;
5. conserva la arquitectura modular;
6. valida workspace y permisos;
7. agrega pruebas unitarias e integración;
8. no implementes funcionalidades fuera del alcance solicitado.

Al terminar, entrega:
- resumen de cambios;
- archivos modificados;
- endpoints creados;
- pruebas ejecutadas;
- decisiones técnicas;
- pendientes o riesgos.
```

---

## 30. Decisiones actualmente vigentes

- El backend se construye con Node.js LTS y Express.
- La API es REST.
- PostgreSQL es la base de datos principal.
- Prisma es el ORM previsto.
- El backend comienza como monolito modular.
- El aislamiento financiero se realiza mediante workspaces.
- La autorización se diseña con RBAC.
- Los identificadores principales son UUID.
- Las fechas de instante usan `TIMESTAMPTZ`.
- Los montos usan `NUMERIC(18,2)`.
- La moneda inicial es COP.
- La zona horaria inicial es `America/Bogota`.
- Los saldos almacenados deben ser reconciliables.
- Las eliminaciones sensibles son lógicas cuando la tabla incluye `deleted_at`.
- La sincronización futura usará eventos y WebSockets.
- El patrón outbox está contemplado desde el esquema inicial.
- La IA debe apoyarse primero en reglas y datos estructurados.
- Web y móvil consumen la misma API y no duplican lógica financiera.

---

## 31. Elementos que todavía deben definirse antes de producción

- versión definitiva de Node.js;
- estrategia de evolución de TypeScript y contratos públicos a medida que crezca el dominio;
- proveedor definitivo de PostgreSQL;
- estrategia exacta de migraciones con Prisma frente al SQL inicial;
- duración de tokens;
- estrategia de rotación de refresh tokens;
- proveedor de correo;
- proveedor de almacenamiento;
- política de retención de auditoría;
- política de respaldos;
- límites de carga de archivos;
- términos legales y política de privacidad;
- alcance de recomendaciones financieras;
- proveedor de IA;
- estrategia de costos y caché de IA;
- estrategia final de colas y Redis;
- contrato OpenAPI.

Estas decisiones no deben inventarse de manera silenciosa durante una implementación.

---

## 32. Estado actual

Actualmente se encuentra creada la estructura inicial de carpetas del backend.

El siguiente objetivo es consolidar el **backend base** antes de desarrollar los módulos de negocio.

La secuencia recomendada inmediata es:

1. revisar `package.json`;
2. confirmar versión de Node.js;
3. configurar Express;
4. configurar variables de entorno;
5. configurar manejo de errores;
6. crear health check;
7. configurar lint y formato;
8. configurar Prisma;
9. conectar PostgreSQL;
10. convertir el esquema SQL en una migración controlada;
11. ejecutar seed de roles y permisos;
12. crear pruebas de infraestructura;
13. iniciar autenticación.

---

## 33. Licencia y estado del producto

Fynar se encuentra en fase de diseño y desarrollo inicial.

La licencia definitiva, política de contribución, modelo comercial y condiciones de uso deben definirse antes de aceptar contribuciones externas o publicar el código como proyecto abierto.

---

## 34. Nota final

Fynar debe crecer de forma progresiva y disciplinada.

La prioridad no es añadir la mayor cantidad posible de funcionalidades, sino construir una base confiable para datos financieros. Cualquier cambio que pueda afectar saldos, movimientos, permisos, privacidad, sesiones o sincronización debe tratarse como un cambio crítico.

La regla principal del proyecto es:

> Los datos financieros deben ser correctos, explicables, aislados por workspace y recuperables antes de ser inteligentes.

---

## 35. Backend base implementado (bloque de parámetros)

### Requisitos e instalación

- Node.js LTS (validado localmente con Node 24.11.1).
- PostgreSQL con el esquema creado por `fynar_reset_y_recrear.sql`.
- `npm install`.

Crear `.env` directamente en la raíz de `BackFynar` y completar las variables documentadas abajo. No se debe ejecutar el script SQL de reset sobre una base con datos. La aplicación no crea tablas ni ejecuta migraciones; Prisma representa el subconjunto utilizado en este bloque y respeta los nombres físicos con `@map`/`@@map`.

Para Neon, `DATABASE_URL` recibe la cadena completa obtenida desde **Connect → Connection string** con **Connection pooling** activado. Branch, Compute, Database y Role se seleccionan en Neon, pero no se guardan como variables separadas: usuario, contraseña, host pooled, base y opciones SSL ya están incluidos dentro de la URL.

```env
PORT=3000
NODE_ENV=development
API_PREFIX=/api/v1
API_VERSION=1.0.0
DATABASE_URL="postgresql://USUARIO:CONTRASEÑA@HOST-POOLER.neon.tech/BASE?sslmode=require&channel_binding=require"
ALLOW_DEGRADED_START=false
ALLOW_DATABASE_TESTS=false
CORS_ORIGINS=http://localhost:5173
LOG_LEVEL=debug
```

No copiar el prefijo de terminal `psql` ni las comillas simples que aparecen en el snippet de Neon; `DATABASE_URL` contiene solamente la URL. Para la configuración mostrada en Neon, la base seleccionada es `neondb`, el rol es `neondb_owner` y el host debe contener `-pooler`. La contraseña debe obtenerse mediante **Show password** o **Copy snippet** y no debe compartirse.

Para iniciar deliberadamente sin PostgreSQL en desarrollo degradado:

```powershell
$env:NODE_ENV="development"
$env:ALLOW_DEGRADED_START="true"
npm run dev
```

Para ejecutar únicamente pruebas HTTP y unitarias:

```powershell
$env:NODE_ENV="test"
npm test
```

### Comandos

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:seed
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:integration
```

El seed es transaccional e idempotente. Verifica los seis roles y doce permisos exactos del SQL y asigna todos los permisos a `OWNER`. No crea categorías porque el SQL no define ninguna categoría base.

### API pública temporal

- `GET /api/v1/health/live`: confirma que el proceso Node responde.
- `GET /api/v1/health/ready`: consulta PostgreSQL con timeout; responde 200 disponible o 503 no disponible.
- `GET /api/v1/health`: resumen compatible; siempre responde 200 y puede indicar estado degradado.
- `GET /api/v1/parameters`: enums y valores por defecto públicos.
- `GET /api/v1/roles`: roles del sistema; debe protegerse o reevaluarse al incorporar autenticación.
- `GET /api/v1/categories/system`: categorías globales activas, de solo lectura.

Los permisos no tienen endpoint público. Los valores `COP`, `es-CO` y los temas corresponden a los defaults/restricciones documentados; monedas, idiomas y temas no son tablas catálogo en el SQL.

### Estructura añadida

`src/config` valida ambiente; `src/database` mantiene una instancia de Prisma; `src/common` centraliza errores; `src/modules/health` y `src/modules/parameters` separan rutas, servicios y repositorios; `prisma` contiene el mapping y seed; `tests` contiene pruebas HTTP y la integración real condicionada a `DATABASE_URL`.

### Decisiones, problemas y pendientes

- El backend fue migrado mecánicamente a TypeScript estricto con NodeNext/ESM. Los imports internos conservan extensión `.js` para que la salida de `tsc` sea ejecutable directamente por Node.
- El SQL oficial se aplicó el 4 de agosto de 2026 después de confirmar que no existían usuarios ni datos financieros. La instancia usa PostgreSQL 18.4.
- Neon utiliza temporalmente una única rama llamada `production` como entorno exclusivo de desarrollo; la base lógica es `neondb`. Fynar aún no está publicado, no tiene usuarios reales y, por limitación del plan actual, desarrollo e integración no están separados.
- PostgreSQL contiene **33 tablas**, 19 enums, 19 índices explícitos, 14 triggers y las extensiones `pgcrypto` y `citext`. `npm run db:verify` contrasta nombres, claves, restricciones y tipos mediante consultas de solo lectura.
- Prisma representa las 33 tablas mediante modelos PascalCase, mappings físicos y relaciones reconciliadas contra introspección real. La siguiente fase es autenticación; no está iniciada.

### Fuente de verdad PostgreSQL

El SQL oficial y PostgreSQL son la fuente de verdad física. Está prohibido ejecutar `prisma db push` o `prisma migrate reset`; el schema Prisma no sustituye las restricciones administradas por SQL.

Prisma no representa por completo varias construcciones del SQL: índices parciales y funcionales, expresiones `LOWER`/`COALESCE`, triggers `updated_at`, extensiones PostgreSQL, restricciones `CHECK`, ni todos los matices de `CITEXT` e `INET`. En particular, el índice `uq_categories_workspace_name_type` es único, parcial y funcional sobre `COALESCE(workspace_id, UUID cero)`, `LOWER(name)` y `type`, condicionado por `deleted_at IS NULL`; no debe aproximarse mediante `@@unique` porque cambiaría su semántica.

### Semántica del seed y protección de integración

El seed administra autoritativamente nombres, descripciones e `is_system` de los seis roles, así como las descripciones de los doce permisos obligatorios. Agrega las asociaciones obligatorias de OWNER, pero no elimina roles, permisos o asociaciones adicionales existentes. Cualquier limpieza requiere una decisión y revisión independientes.

`npm test` no requiere PostgreSQL. La integración real exige `NODE_ENV=test` y `ALLOW_DATABASE_TESTS=true`. En la rama compartida actual exige además `ALLOW_SHARED_DEV_DATABASE_TESTS=true`; crea datos identificables dentro de transacciones reversibles y no borra ni trunca tablas.

### TypeScript, desarrollo y producción

El código propio de `src`, `prisma`, `scripts` y `tests` está en TypeScript. La configuración usa `strict`, `noImplicitAny`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`. Los imports ESM escritos con extensión `.js` son intencionales bajo `moduleResolution: NodeNext`: TypeScript los resuelve contra `.ts` durante desarrollo y Node los resuelve contra `.js` dentro de `dist`.

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run dev
```

Para compilar y ejecutar la salida de producción:

```powershell
npm run build
$env:NODE_ENV="production"
npm start
```

`npm run build` limpia `dist` y genera mapas de fuente. `npm start` ejecuta `dist/server.js`. En un despliegue, el proveedor debe usar `/api/v1/health/ready` como readiness; `/health/live` solo confirma que Node responde y `/health` conserva el resumen compatible que puede indicar estado degradado con HTTP 200.

El build de producción usa `tsconfig.build.json`, compila únicamente `src` y genera `dist/server.js`; no copia pruebas, scripts, seed ni configuración Prisma. Prisma Client se genera explícitamente mediante `npm run prisma:generate` durante typecheck/build. No existe `postinstall`: así `npm ci --omit=dev` no depende del CLI `prisma`, que permanece correctamente en `devDependencies`. La instalación reducida sirve para ejecutar un artefacto previamente compilado, no para compilarlo.

`scripts/run-prisma-offline.ts` invoca `node_modules/prisma/build/index.js` para ejecutar exclusivamente `validate` y `generate` sin descarga mediante red. Esa ruta interna corresponde a Prisma 6.19 y debe revisarse antes de cualquier actualización de Prisma.

El seed TypeScript se ejecuta mediante `npm run prisma:seed`. Fue probado dos veces con resultados estables: 6 roles, 12 permisos y 12 asociaciones obligatorias de OWNER. Es transaccional, idempotente, aditivo y no elimina roles o permisos adicionales.

### Estado de la hoja de ruta

**Fase 0 — Base técnica: COMPLETADA.**

### Fase 1 — Autenticación: INICIADA

El primer bloque de la Fase 1 creó exclusivamente las fronteras estructurales de `src/modules/users` y `src/modules/auth`. Todavía no existe autenticación funcional y no se registraron endpoints nuevos.

- `users` será responsable de la entidad de aplicación, perfil y estado del usuario.
- `auth` será responsable de credenciales, identidades, sesiones y autenticación.
- `auth` puede depender del índice público de `users`; `users` no depende de `auth`.
- Los repositorios son contratos sin implementación, los routers están vacíos y no se montan en la aplicación.
- Los archivos de servicio, controlador y schemas delimitan responsabilidades futuras sin simular comportamiento.

El segundo bloque incorporó `src/modules/auth/auth-password.service.ts`, que encapsula `argon2@0.45.1` mediante el contrato `PasswordService`. El hash usa explícitamente Argon2id, sal automática y formato PHC; la verificación devuelve `false` ante hashes incompatibles o malformados y permite propagar errores internos distintos de errores de formato.

La política inicial acepta frases de contraseña sin transformarlas: mínimo 10 y máximo 128 caracteres. El contrato estricto `registerSchema` acepta exclusivamente `email`, `password`, `firstName` y `lastName`; normaliza el correo con trim/minúsculas, recorta espacios externos de nombres y transforma un apellido vacío en `undefined`.

Configuración Argon2id:

- `AUTH_PASSWORD_MEMORY_COST`: memoria en KiB, default 65536 y mínimo de entorno 19456.
- `AUTH_PASSWORD_TIME_COST`: iteraciones, default 3 y mínimo 2.
- `AUTH_PASSWORD_PARALLELISM`: paralelismo, default 1.

La factory aplica los mismos mínimos que la configuración central y rechaza valores inferiores, decimales o no finitos. Las pruebas criptográficas usan explícitamente el mínimo válido de 19456 KiB, 2 iteraciones y paralelismo 1, sin alterar los defaults de ejecución. La prevalidación solo exige el prefijo PHC de Argon2id y delega el análisis restante a `argon2.verify`; errores conocidos de formato devuelven `false` y otros errores se propagan.

Este texto describía el estado previo al cierre de la Fase 1. El bloque de autenticación descrito en la sección siguiente reemplaza ese estado: registro, login, JWT, sesiones rotatorias, logout y recuperación ya forman parte de la API. RBAC de negocio permanece fuera de esta fase.

La ruta del SQL para el inventario se resuelve, en orden, desde el argumento, `FYNAR_SQL_PATH` o ubicaciones relativas conocidas. Uso portátil recomendado:

```powershell
npm run sql:inventory -- "../fynar_reset_y_recrear.sql"
```

### Empaquetado seguro

No compartir `.env` ni dependencias instaladas. Desde la raíz del backend, una forma reproducible de crear el ZIP con `tar` es:

```powershell
$packageTemp = Join-Path $env:TEMP ("BackFynar-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $packageTemp | Out-Null
robocopy . $packageTemp /E /XD node_modules coverage /XF .env .env.* *.log *.tmp *.bak schema.introspected.prisma
tar -a -c -f ../BackFynar-source.zip -C $packageTemp .
Remove-Item -LiteralPath $packageTemp -Recurse -Force
```

El directorio temporal tiene un nombre generado y se elimina solo después de comprimirlo. Revisar el contenido antes de compartir y confirmar que no contiene ningún archivo `.env`.

El procedimiento automatizado preferido es `npm run source:pack`. Usa una lista permitida, crea `artifacts/BackFynar-source.zip` y rechaza si detecta `.env`, `node_modules`, `dist`, cobertura, logs, temporales, backups o un schema introspectado temporal.

### Pulido final de calidad y observabilidad

- `npm run format` aplica Prettier y `npm run format:check` verifica el formato sin escribir.
- Cada solicitud recibe un `X-Request-Id`: se reutiliza si contiene entre 1 y 128 caracteres seguros; en otro caso se genera con `crypto.randomUUID()`.
- Los logs HTTP son JSON estructurado con `requestId`, método, path sin query string, estado, duración y user agent opcional dentro de `context`. No incluyen cuerpos, cookies, autorización, tokens ni URLs de base de datos. `/health/live` usa nivel `debug`.
- `/api/v1/health/live` responde 200 mientras Node esté activo. `/api/v1/health/ready` responde 200 con dependencias disponibles y 503 si falta la base, falla la base o comenzó el apagado. `/api/v1/health` conserva HTTP 200 como resumen compatible, incluso degradado.
- Al comenzar `SIGINT`/`SIGTERM`, el lifecycle marca `APPLICATION_SHUTTING_DOWN`; readiness deja de consultar PostgreSQL y devuelve 503 para solicitudes que ya estén en curso.
- `npm run verify` ejecuta typecheck, ESLint, Prettier, pruebas, build y validación Prisma sin conectarse a PostgreSQL.
- `npm run clean` elimina únicamente `dist`, `coverage` y carpetas locales `.clean-validation-*`; nunca elimina `.env`, fuentes, schema Prisma ni lockfile.
- El artefacto que debe compartirse es `artifacts/BackFynar-source.zip`, generado y verificado mediante `npm run source:pack`. No compartir manualmente la carpeta de trabajo completa.

# Fase 1 — Autenticación

La API de autenticación vive bajo `/api/v1/auth` y expone:

- `POST /register`: crea atómicamente usuario, identidad LOCAL, workspace PERSONAL, membresía OWNER y preferencias.
- `POST /login`: valida credenciales sin revelar si el correo existe y crea una sesión.
- `POST /refresh`: lee la cookie HttpOnly, rota el refresh token y reemplaza la cookie; reutilizar uno consumido revoca su familia.
- `POST /logout`: revoca la sesión representada por la cookie actual y la elimina.
- `POST /logout-all`: revoca todas las sesiones del usuario autenticado y elimina la cookie actual.
- `GET /me`: devuelve exclusivamente el perfil público.
- `POST /forgot-password`: siempre responde de forma neutral.
- `POST /reset-password`: consume una sola vez el token y revoca todas las sesiones.

Los access tokens son JWT HS256 con `issuer`, `audience`, `subject` y `sid`; el middleware también comprueba en PostgreSQL que la sesión continúe activa. Los refresh y reset tokens son aleatorios de 256 bits y PostgreSQL almacena únicamente SHA-256. El access token se devuelve en JSON y el refresh token se transporta exclusivamente mediante la cookie `fynar_refresh_token`, inaccesible a JavaScript. La cookie usa `HttpOnly`, alcance `/api/v1/auth`, duración igual a `REFRESH_TOKEN_TTL_DAYS`, `SameSite=Lax` sin `Secure` en localhost y `SameSite=None` con `Secure` en producción HTTPS. CORS admite credenciales solo para los orígenes configurados en `CORS_ORIGINS`.

## Correo de recuperación

`EmailService` desacopla los casos de uso del proveedor. Producción exige `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, un secreto JWT propio y un remitente configurable. Antes de producción debe verificarse el dominio en Resend, configurar SPF/DKIM, usar una API key restringida al envío y un `EMAIL_FROM` perteneciente al dominio verificado. `EMAIL_PROVIDER=console` sólo está permitido fuera de producción: registra que el correo **no fue enviado** y nunca registra el enlace o token.

## Proxy y rate limiting

`TRUST_PROXY` es `false` por defecto. Puede configurarse como `loopback` cuando el proxy inverso corre en la misma máquina, o como un número de saltos confiables entre `1` y `3`. Debe coincidir exactamente con la topología de Render, Railway, Nginx o Cloudflare; un valor demasiado amplio permitiría falsificar `X-Forwarded-For` y afectaría `request.ip`, auditoría, metadatos de sesión y rate limiting.

Registro, login, refresh, forgot-password y reset-password tienen límites separados. El MVP usa el `MemoryStore` de `express-rate-limit`: funciona en una sola instancia y se reinicia con el proceso. Antes de desplegar múltiples réplicas debe reemplazarse por un store compartido —por ejemplo Redis— para mantener límites globales consistentes.

## Migraciones

La base de Fase 0 fue creada mediante el SQL oficial y se registró como baseline `20260805100000_phase0_baseline`. La ampliación aditiva de autenticación está en `20260805110000_phase1_auth_sessions`. Use `npm run prisma:migrate:dev -- --name <nombre>` en desarrollo y `npm run prisma:migrate:deploy` en despliegues. Prisma 6.19 no incluyó automáticamente `citext`/`pgcrypto` al reconstruir el baseline en una shadow database vacía; al actualizar Prisma debe revisarse este baseline y preparar una shadow database con ambas extensiones.

# Fase 2 — Usuarios, workspaces y permisos

La Fase 2 incorpora perfil editable, preferencias, selección de workspace, membresías activas y autorización RBAC resuelta directamente desde PostgreSQL. Los permisos no forman parte del JWT: cada ruta protegida vuelve a resolver membresía, rol y asociaciones `role_permissions`, por lo que una suspensión, cambio de rol o revocación tiene efecto inmediato.

## Endpoints

- `GET /api/v1/users/me`: perfil público editable del usuario autenticado.
- `PATCH /api/v1/users/me`: modifica `firstName`, `lastName`, `phone` y `avatarUrl`.
- `GET /api/v1/users/me/preferences`: preferencias propias.
- `PATCH /api/v1/users/me/preferences`: modifica únicamente preferencias admitidas.
- `GET /api/v1/workspaces`: membresías activas del usuario.
- `GET /api/v1/workspaces/:workspaceId`: contexto público de un workspace autorizado.
- `POST /api/v1/workspaces/:workspaceId/select`: actualiza `defaultWorkspaceId` de forma transaccional.

`/auth/me` conserva la responsabilidad de confirmar identidad y sesión; `/users/me` administra el perfil editable. El correo no puede modificarse en esta fase.

## Contexto y política de autorización

El workspace se indica exclusivamente mediante `:workspaceId` en la URL. Headers, query y body no son fuentes de autorización. `resolveWorkspaceContext` valida el UUID, usuario activo, membresía `ACTIVE`, workspace activo y no eliminado; después adjunta un contexto tipado con workspace, rol y permisos efectivos.

La política HTTP es:

- Sin autenticación o con sesión revocada: `401`.
- Sin membresía activa, workspace privado/inactivo o usuario ajeno: `404`, evitando confirmar su existencia.
- Miembro válido sin el permiso requerido: `403`.

Las rutas futuras deben protegerse así:

```ts
router.get(
  "/workspaces/:workspaceId/accounts",
  authenticate,
  resolveWorkspaceContext,
  requirePermission("accounts.read"),
  controller,
);
```

Regla obligatoria: todo recurso de negocio debe consultarse simultáneamente por su ID y por `request.workspace.workspaceId`. Nunca debe consultarse un recurso perteneciente a un workspace únicamente por su ID.

## Preferencias

Se admiten `defaultWorkspaceId`, `language`, `currency`, `timezone`, `dateFormat`, `theme`, `startScreen` y `dashboardLayout`. El workspace predeterminado debe tener membresía activa; `dashboardLayout` debe ser un objeto JSON de hasta 16 KiB. La zona horaria se valida mediante `Intl` y el tema admite `LIGHT`, `DARK` o `SYSTEM`.

No se usa Redis en esta fase. La consulta directa a PostgreSQL prioriza consistencia y permite incorporar caché invalidable posteriormente. No se implementan creación de workspaces, invitaciones, administración de roles ni recursos financieros.

# Fase 3 — Cuentas financieras

La Fase 3 implementa cuentas financieras dentro del workspace autorizado. Todas las rutas se encuentran bajo `/api/v1/workspaces/:workspaceId/accounts`, usan la sesión activa y el contexto resuelto de Fase 2, y consultan cada cuenta por `accountId` **y** `workspaceId`. Un ID perteneciente a otro workspace responde `404` sin revelar su existencia.

## Endpoints y permisos

- `POST /`: crear (`accounts.write`).
- `GET /`: listar (`accounts.read`).
- `GET /:accountId`: detalle y saldo actual (`accounts.read`).
- `PATCH /:accountId`: actualización parcial (`accounts.write`).
- `PATCH /:accountId/favorite`: establecer `isFavorite` de forma idempotente (`accounts.write`).
- `POST /:accountId/archive`: archivar mediante `isActive=false` (`accounts.write`).
- `POST /:accountId/restore`: restaurar mediante `isActive=true` (`accounts.write`).
- `DELETE /:accountId`: eliminación lógica mediante `deletedAt` (`accounts.write`).

El listado excluye eliminadas y archivadas por defecto. `archived=true` devuelve solamente archivadas; también admite `type`, `nature`, `favorite`, `currency` y `search`. Devuelve como máximo 100 cuentas, ordenadas por favorita descendente, actividad descendente, nombre ascendente y fecha de creación ascendente.

## Contrato y reglas

La respuesta pública contiene `id`, `name`, `type`, `nature`, `institutionName`, `currency`, `openingBalance`, `currentBalance`, datos opcionales de tarjeta, presentación, preferencias de patrimonio/favorito/actividad y fechas públicas. No expone `workspaceId` ni `deletedAt`.

Los tipos reales son `CASH`, `CHECKING`, `SAVINGS`, `E_WALLET`, `CREDIT_CARD`, `INVESTMENT`, `LOAN` y `OTHER`. Los cinco primeros tipos de activo deben usar naturaleza `ASSET`; `CREDIT_CARD` y `LOAN` deben usar `LIABILITY`; `OTHER` admite ambas. `creditLimit`, `billingDay` y `paymentDueDay` sólo se admiten para `CREDIT_CARD`; el límite debe ser positivo y los días deben estar entre 1 y 31.

Todos los importes se reciben y devuelven como cadenas decimales con hasta dos posiciones de entrada y exactamente dos de salida. Se convierten explícitamente a `Prisma.Decimal`; no se usa `number` para dinero. En creación, `currentBalance = openingBalance`. Como aún no existen movimientos, editar `openingBalance` sincroniza ambos valores dentro de una transacción serializable. El cliente nunca puede escribir `currentBalance`. Cuando se implementen movimientos, esa edición deberá bloquearse o disparar un recálculo transaccional; `currentBalance` continuará siendo una caché derivada.

Las cuentas archivadas pueden editarse y conservar su saldo. Archivar y restaurar son operaciones distintas de eliminar. El `DELETE` nunca elimina físicamente y es idempotente para una cuenta propia ya eliminada; las consultas normales y mutaciones posteriores la excluyen. La fila queda disponible para historial y auditoría futura.

El nombre de una cuenta es único dentro del workspace incluyendo las filas eliminadas lógicamente. Para el MVP, un nombre perteneciente a una cuenta eliminada permanece reservado: crear o renombrar otra cuenta con ese nombre responde `409` con un mensaje público que indica restaurar la cuenta anterior o utilizar otro nombre. La restricción `@@unique([workspaceId, name])` se conserva y no se oculta ni elimina la fila histórica.

Las validaciones dependientes del estado y las mutaciones usan transacciones serializables con reintentos para conflictos. Las escrituras son condicionales a `id + workspaceId + deletedAt IS NULL`, por lo que update/delete y acciones simultáneas no pueden trasladar ni resucitar cuentas. El esquema actual no requiere migración ni dispone de campo de versión; no se agregó uno artificialmente.

## Validación y alcance

Las pruebas unitarias cubren contratos estrictos, dinero, tipos/naturalezas y coherencia de tarjeta. Las pruebas reales de integración cubren CRUD lógico, favoritos, archivo/restauración, RBAC en tiempo real, membresía suspendida, workspace inactivo, sesión revocada y aislamiento bidireccional. Cada suite crea y elimina exclusivamente sus propios registros; no trunca tablas ni modifica seeds oficiales.

Las futuras acciones de crear, cambiar saldo inicial, marcar favorita, archivar, restaurar y eliminar deberán incorporarse a auditoría cuando esa capacidad se active. No se anticiparon eventos, movimientos ni mocks de producción. La fase siguiente podrá implementar categorías, pero no forma parte de este bloque.

# Fase 4 — Categorías

La API de categorías vive bajo `/api/v1/workspaces/:workspaceId/categories`. Combina el catálogo global de solo lectura con las categorías personalizadas del workspace, sin copiar categorías globales a cada espacio.

## Endpoints y permisos

- `GET /`: lista categorías globales y personalizadas; requiere `categories.read`.
- `GET /:categoryId`: consulta una categoría visible; requiere `categories.read`.
- `POST /`: crea una categoría personalizada; requiere `categories.write`.
- `PATCH /:categoryId`: edita nombre, padre, icono o color; requiere `categories.write`.
- `DELETE /:categoryId`: archiva lógicamente; requiere `categories.write`.
- `POST /:categoryId/restore`: restaura una categoría archivada; requiere `categories.write`.

OWNER, ADMIN, MEMBER y ACCOUNTANT poseen lectura y escritura. VIEWER y ADVISOR poseen solamente lectura. Los permisos se resuelven en PostgreSQL en cada solicitud.

## Payloads y respuestas

Creación de una categoría principal:

```http
POST /api/v1/workspaces/00000000-0000-4000-8000-000000000001/categories
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "name": "Gastos del hogar",
  "type": "EXPENSE",
  "icon": "house",
  "color": "#2563EB"
}
```

Creación de una subcategoría:

```json
{
  "name": "Restaurantes",
  "type": "EXPENSE",
  "parentId": "00000000-0000-4000-8000-000000000002",
  "icon": "utensils",
  "color": "#EF4444"
}
```

La respuesta pública contiene `id`, `parentId`, `name`, `type`, `icon`, `color`, `scope`, `isSystem`, `isActive`, `createdAt` y `updatedAt`. No expone `workspaceId` ni `deletedAt`.

Los tipos admitidos son `INCOME`, `EXPENSE`, `TRANSFER` e `INVESTMENT`. El tipo es inmutable después de crear la categoría. Los nombres eliminan espacios externos y reducen secuencias internas a uno; los iconos son identificadores como `shopping-bag`, nunca HTML/SVG, y el color usa `#RRGGBB`.

## Catálogo, jerarquía y aislamiento

El seed incorpora 28 categorías globales principales con `workspaceId=null`, `isSystem=true`, icono y color. Son visibles para todos los workspaces, pero no pueden editarse, archivarse ni restaurarse mediante la API. Una categoría personalizada puede compartir nombre con una global.

El MVP permite solamente una categoría principal y un nivel de subcategorías. Padre e hijo deben tener el mismo tipo. El padre debe estar activo y ser global o pertenecer al mismo workspace. No se admiten autorreferencias, ciclos, terceros niveles ni padres privados de otros workspaces.

Las categorías personalizadas siempre se consultan por `categoryId` y el workspace autorizado; las globales se admiten mediante un criterio explícito `workspaceId=null AND isSystem=true`. Una categoría privada ajena responde `404`.

## Unicidad, archivo y restauración

La unicidad se aplica por workspace, nombre normalizado sin distinguir mayúsculas, tipo y padre. El mismo nombre bajo padres distintos es válido. Los nombres archivados permanecen reservados; una colisión en creación, edición o restauración responde `409` sin exponer información de Prisma.

`DELETE` establece `isActive=false` y `deletedAt`, sin eliminar físicamente. Una categoría padre con hijos activos no puede archivarse. Restaurar la misma fila es idempotente y conserva su nombre reservado. Las categorías archivadas se consultan con `status=ARCHIVED` o se incluyen junto con las activas mediante `includeArchived=true`.

El índice funcional `uq_categories_workspace_name_type_parent` normaliza el nombre también en PostgreSQL y no tiene predicado sobre `deleted_at`. Prisma 6.19 no puede representar este índice de expresión en `schema.prisma`; su definición autoritativa está en la migración `20260805120000_phase4_category_uniqueness` y no debe eliminarse durante una futura introspección o actualización.

## Filtros

El listado admite `type`, `status=ACTIVE|ARCHIVED`, `includeArchived=true|false`, `parentId`, `scope=ALL|SYSTEM|CUSTOM` y `search`. `parentId` acepta únicamente un UUID; `parentId=null` no forma parte del contrato actual y el filtrado exclusivo de categorías principales queda pendiente para el cliente o una fase posterior. `status` no puede combinarse con `includeArchived=true`. El máximo es 500 resultados, ordenados por alcance, tipo, padre y nombre.

# Fase 5 — Movimientos financieros

Los movimientos viven bajo `/api/v1/workspaces/:workspaceId/transactions`. `GET /` y `GET /:transactionId` requieren `transactions.read`; `POST /income`, `POST /expense`, `POST /transfer`, `PATCH /:transactionId` y `DELETE /:transactionId` requieren `transactions.write`. Se mantienen endpoints de creación separados para que cada tipo tenga un contrato estricto.

Ingreso y gasto reciben `accountId`, `categoryId`, `amount` como string decimal positivo, `occurredAt` ISO 8601 con zona y opcionalmente `description`, `notes` y `merchantName`. Transferencia añade `destinationAccountId`. La API rechaza `workspaceId`, saldos, moneda, estado, versión inicial y demás campos internos. La moneda se deriva de la cuenta; transferencias exigen cuentas distintas y con igual moneda.

Un ingreso incrementa una cuenta ASSET y exige categoría INCOME. Un gasto reduce el saldo y exige categoría EXPENSE. No existe una restricción de dominio que prohíba saldo negativo, por lo que no se inventó una. En LIABILITY, un gasto reduce el saldo algebraico y representa mayor deuda; los ingresos directos en pasivos se rechazan. Una transferencia reduce el origen, incrementa el destino y exige categoría TRANSFER. Solo `INCOME`, `EXPENSE` y `TRANSFER` tienen efecto financiero implementado. Los tipos `INVESTMENT`, `DEBT_PAYMENT`, `ADJUSTMENT` y `REFUND` no pueden crearse por la API ni editarse o cancelarse en esta fase; si una fila de esos tipos ya existe, las mutaciones responden `409` sin modificar el movimiento ni las cuentas.

Cada escritura bloquea las cuentas afectadas en orden estable, utiliza `Prisma.Decimal`, incrementos atómicos y una transacción serializable. Los conflictos serializables SQLSTATE `40001`, los deadlocks `40P01` y el error Prisma `P2034` se reintentan de forma limitada, con un máximo de tres intentos. Una edición exige `version`, bloquea el movimiento, revierte completamente el efecto anterior, valida y aplica el nuevo, e incrementa la versión. Un conflicto optimista responde `409` y revierte todo.

La cancelación recibe `{ "version": n }` en el cuerpo de DELETE, revierte una sola vez, establece `status=CANCELLED`, `deletedAt` e incrementa `version`; la fila nunca se elimina físicamente. Repetir exactamente el mismo DELETE con la versión inicial devuelve nuevamente `204` sin cambiar saldos, `version`, `updatedAt` ni `deletedAt`. Una versión obsoleta sobre un movimiento que todavía está `CONFIRMED` responde `409`.

El listado admite `type`, `status`, `accountId`, `destinationAccountId`, `categoryId`, `dateFrom`, `dateTo`, `minAmount`, `maxAmount`, `search`, `page` y `limit`. Cuando se envían `accountId` y `search`, ambos filtros se combinan mediante `AND`: el movimiento debe involucrar la cuenta y coincidir con el texto. El límite máximo es 100 y el orden determinista es `occurredAt DESC, id DESC`. La respuesta incluye `items`, `page`, `limit`, `total` y `totalPages`. Los montos se serializan siempre con dos decimales; el modelo público excluye workspace, creador, metadata, IA y campos de sincronización internos.

# Fase 6 — Dashboard financiero

El resumen financiero se consulta mediante `GET /api/v1/workspaces/:workspaceId/dashboard` y requiere sesión, membresía activa en el workspace y el permiso existente `reports.read`. La ruta es completamente de solo lectura: no actualiza saldos o fechas, no crea snapshots, auditoría, outbox ni otras filas.

## Parámetros temporales

- `period`: `CURRENT_MONTH` por defecto, `PREVIOUS_MONTH`, `LAST_7_DAYS`, `LAST_30_DAYS` o `CUSTOM`.
- `dateFrom` y `dateTo`: fechas ISO `YYYY-MM-DD`, obligatorias exclusivamente para `CUSTOM`. Ambas fechas son inclusivas y `dateFrom <= dateTo`.
- `recentLimit`: entero entre 1 y 20; valor predeterminado 5.

Los meses son meses calendario. Los periodos móviles incluyen el día actual del workspace y los 6 o 29 días anteriores. Cada límite se convierte desde medianoche local usando `workspace.timezone`, incluida la variación por horario de verano. El intervalo interno es semiabierto `[dateFrom, endExclusive)` y el payload presenta `dateTo` como el último milisegundo incluido. El periodo anterior usa el mes calendario precedente o el mismo número de días inmediatamente anteriores.

## Fórmulas y monedas

Todas las operaciones monetarias usan `Prisma.Decimal` y se serializan con dos decimales.

- `availableMoney`: suma de `currentBalance` de cuentas `ASSET` activas y no eliminadas. No considera pasivos ni suma nuevamente movimientos.
- `totalIncome`: suma de `INCOME` confirmados, no eliminados y dentro del periodo.
- `totalExpenses`: suma de `EXPENSE` confirmados, no eliminados y dentro del periodo.
- `netCashFlow`: `totalIncome - totalExpenses`.
- `netWorth`: suma de activos incluidos en patrimonio menos el valor absoluto de cada pasivo incluido. Esto admite que una obligación esté representada con saldo positivo o negativo sin convertirla accidentalmente en activo.

Las cuentas pueden usar una moneda diferente de `workspace.baseCurrency`. No existe conversión cambiaria: `summariesByCurrency`, `comparisonByCurrency`, `expensesByCategory` y `accountsByType` se separan por `currency`. Nunca se suman monedas distintas. `baseCurrency` se devuelve como contexto y siempre tiene un resumen, incluso en un workspace vacío.

Solo `INCOME`, `EXPENSE` y `TRANSFER` pueden aparecer en movimientos recientes. Las transferencias no afectan ingresos, gastos, flujo ni patrimonio porque trasladan fondos dentro del mismo workspace. Los movimientos cancelados, eliminados, aplazados y ajenos al workspace quedan excluidos. Las categorías archivadas conservan nombre, icono y color en la agrupación histórica. Los porcentajes se calculan frente al gasto total de la misma moneda con dos decimales; cuando el total es cero se devuelve `0.00`. En una comparación, un porcentaje es `null` si el valor anterior es cero, porque no existe base comparable.

El repositorio ejecuta cinco consultas independientes en paralelo: cuentas activas, agregados actuales, agregados anteriores, movimientos recientes y gastos agrupados. Luego realiza como máximo una consulta adicional para resolver todas las categorías usadas. En paralelo, el dashboard reutiliza el listado agregado de presupuestos para devolver hasta 100 presupuestos activos que intersectan el periodo consultado, con su progreso y proyección. No existe N+1 y ninguna consulta de datos financieros omite `workspaceId`.

## Respuesta

```json
{
  "success": true,
  "data": {
    "period": {
      "type": "CURRENT_MONTH",
      "dateFrom": "2026-08-01T05:00:00.000Z",
      "dateTo": "2026-09-01T04:59:59.999Z",
      "timezone": "America/Bogota"
    },
    "baseCurrency": "COP",
    "summariesByCurrency": [
      {
        "currency": "COP",
        "availableMoney": "2500000.00",
        "totalIncome": "3000000.00",
        "totalExpenses": "1200000.00",
        "netCashFlow": "1800000.00",
        "netWorth": "5200000.00"
      }
    ],
    "accountBalances": [],
    "recentTransactions": [],
    "budgetProgress": [],
    "expensesByCategory": [],
    "accountsByType": [],
    "comparisonByCurrency": [
      {
        "currency": "COP",
        "currentIncome": "3000000.00",
        "previousIncome": "2800000.00",
        "incomeChangeAmount": "200000.00",
        "incomeChangePercentage": "7.14",
        "currentExpenses": "1200000.00",
        "previousExpenses": "1000000.00",
        "expenseChangeAmount": "200000.00",
        "expenseChangePercentage": "20.00",
        "currentNetCashFlow": "1800000.00",
        "previousNetCashFlow": "1800000.00"
      }
    ]
  }
}
```

Ejemplo:

```http
GET /api/v1/workspaces/00000000-0000-0000-0000-000000000000/dashboard?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31&recentLimit=10
Authorization: Bearer <access-token>
```

Quedan aplazados reportes descargables, deudas, cuotas, metas, calendario, conversión de monedas, pronósticos, recomendaciones, IA, caché, materialized views y snapshots automáticos.

# Fase 7 — Presupuestos

Los presupuestos se administran bajo `/api/v1/workspaces/:workspaceId/budgets`:

- `GET /`: listado paginado con `budgets.read`.
- `GET /:budgetId`: detalle y progreso con `budgets.read`.
- `POST /`: creación transaccional con `budgets.write`.
- `PATCH /:budgetId`: edición transaccional con `budgets.write`.
- `DELETE /:budgetId`: archivado lógico con `budgets.write`.
- `POST /:budgetId/restore`: restauración con `budgets.write`.

En la política RBAC actual, `budgets.read` y `budgets.write` están asociados únicamente a `OWNER`. No se ampliaron roles durante esta fase.

## Definición y asociaciones

La creación recibe `name`, `period`, `startsOn`, `endsOn`, `amount`, `currency`, `alertThreshold`, `rolloverEnabled`, `categoryIds` y `accountIds`. El body es estricto y rechaza `workspaceId`, gasto, restante, porcentaje, proyección, estado, timestamps y campos internos.

`amount` es un string decimal positivo compatible con `DECIMAL(18,2)`. `currency` acepta exactamente tres letras ASCII y se persiste en mayúsculas; no acepta espacios. Un presupuesto puede usar una moneda diferente de `workspace.baseCurrency`, pero todas sus cuentas asociadas deben tener la misma moneda. Los movimientos se filtran por la moneda explícita del presupuesto y nunca existe conversión.

Las categorías nuevas deben ser globales o personalizadas del mismo workspace, estar activas y ser `EXPENSE`. Las cuentas nuevas deben pertenecer al workspace, estar activas, no eliminadas y tener la moneda del presupuesto. Las asociaciones históricas se conservan y continúan participando en el cálculo si una categoría o cuenta se archiva posteriormente. Restaurar un presupuesto vuelve a validar que todas las asociaciones estén activas y sean compatibles.

Sin categorías asociadas se admite cualquier categoría de gasto; sin cuentas se admite cualquier cuenta de la moneda. Cuando existen ambas asociaciones, el movimiento debe satisfacer categoría **y** cuenta. Los presupuestos superpuestos están permitidos: un gasto puede contar independientemente en un presupuesto general, uno por categoría y otro por cuenta; nunca se reparte automáticamente.

`allocatedAmount` permanece sin uso porque su semántica se aplazó. `rolloverEnabled` se almacena y puede editarse, pero no ejecuta acumulación ni renovación automática.

## Periodos y zona horaria

Las fechas son `YYYY-MM-DD` y se reciben explícitamente:

- `WEEKLY`: siete días calendario inclusivos; `endsOn = startsOn + 6`.
- `MONTHLY`: desde el primer hasta el último día del mismo mes.
- `YEARLY`: del 1 de enero al 31 de diciembre del mismo año.
- `CUSTOM`: cualquier rango donde `endsOn >= startsOn`.

Para consultar movimientos se convierten a `[inicio, fin exclusivo)` con `workspace.timezone`, incluidos cambios DST. El progreso se calcula hasta el instante actual; movimientos futuros no aumentan el gasto ni la proyección.

## Progreso y proyección

Solo cuentan movimientos del workspace con `type=EXPENSE`, `status=CONFIRMED`, `deletedAt=null`, moneda coincidente, fecha dentro del periodo y asociaciones aplicables. Ingresos, transferencias, tipos aplazados, cancelados, eliminados, datos ajenos y otras monedas quedan excluidos.

- `spent`: suma derivada de movimientos; nunca se persiste.
- `remaining`: `amount - spent`.
- `percentage`: `spent / amount × 100`.
- `SAFE`: porcentaje menor al umbral.
- `WARNING`: porcentaje igual o mayor al umbral sin superar el monto.
- `EXCEEDED`: gasto mayor al monto.

La proyección lineal usa `spent / días transcurridos × días totales`. Antes del periodo devuelve cero; después devuelve el gasto real. Incluye `projectedSpend`, `projectedRemaining`, `projectedPercentage` y `projectedStatus`. Utiliza `Prisma.Decimal`, no IA ni históricos anteriores, y no genera notificaciones.

## Listado y rendimiento

Filtros: `includeArchived`, `period`, `currency`, `dateFrom`, `dateTo`, `categoryId`, `accountId`, `search`, `page` y `limit`. El máximo es 100. Los filtros se combinan mediante AND y el orden es `startsOn DESC`, `name ASC`, `id ASC`.

El listado pagina en PostgreSQL y ejecuta una sola agregación SQL para calcular el gasto de todos los presupuestos de la página. La agregación relaciona dinámicamente fechas, moneda, categorías y cuentas de cada presupuesto; no realiza una consulta de movimientos por presupuesto ni N+1 de asociaciones.

Ejemplo:

```http
POST /api/v1/workspaces/00000000-0000-0000-0000-000000000000/budgets
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "name": "Alimentación agosto",
  "period": "MONTHLY",
  "startsOn": "2026-08-01",
  "endsOn": "2026-08-31",
  "amount": "600000.00",
  "currency": "COP",
  "alertThreshold": "80.00",
  "rolloverEnabled": false,
  "categoryIds": ["00000000-0000-0000-0000-000000000000"],
  "accountIds": []
}
```

Los errores de validación responden `400`; recursos ajenos, archivados o incompatibles se presentan como no encontrados sin revelar su existencia; asociaciones duplicadas concurrentes responden `409`. No existe control optimista porque `budgets` no tiene campo `version`.

Quedan aplazados rollover automático, asignaciones parciales por categoría, notificaciones, outbox, procesos programados, reportes descargables, deudas, metas, calendario, IA y cualquier funcionalidad de la Fase 8.

Errores esperados: `400` para contratos inválidos, `403` por permiso insuficiente, `404` para movimiento, cuenta o categoría no visible y `409` para versión obsoleta o incompatibilidad financiera. Splits, adjuntos, recurrencias, snapshots programados, auditoría y outbox no se implementan en esta fase.

# Fase 8 — Reportes financieros básicos

Los reportes son consultas derivadas y exclusivamente de lectura. No existe una tabla `reports`, no se persisten agregados y no se crean snapshots, auditorías ni eventos outbox. Todos los endpoints requieren solamente `reports.read` y se encuentran bajo `/api/v1/workspaces/:workspaceId/reports`:

- `GET /income-vs-expenses`: totales, conteos, promedios, flujo neto y comparación con el periodo anterior.
- `GET /expenses-by-category`: gasto agrupado por categoría y moneda, con `limit=20` y máximo 100.
- `GET /cash-flow`: serie temporal de ingresos, gastos y flujo neto, incluidos buckets sin movimientos.
- `GET /account-balances`: saldos actuales paginados y resumen por moneda, con `limit=25` y máximo 100.

## Periodos, filtros y monedas

Los reportes transaccionales admiten `CURRENT_MONTH`, `PREVIOUS_MONTH`, `LAST_7_DAYS`, `LAST_30_DAYS`, `CURRENT_YEAR`, `PREVIOUS_YEAR` y `CUSTOM`. `CUSTOM` exige `dateFrom` y `dateTo` en `YYYY-MM-DD`, permite como máximo 366 días y los periodos predefinidos rechazan fechas manuales. Los límites se construyen como intervalo UTC semiabierto a partir de `workspace.timezone`, no de la zona del servidor.

Los filtros `currency`, `accountId` y `categoryId` se combinan mediante AND. La moneda se normaliza a tres letras mayúsculas y nunca se convierten ni suman monedas distintas. Las categorías privadas ajenas no revelan su existencia; las globales y las archivadas pueden filtrar movimientos históricos. Como no se almacena un snapshot del nombre de categoría, renombrarla cambia la etiqueta mostrada para su historia.

En flujo de caja, `groupBy` admite `DAY`, `WEEK` y `MONTH`: siete días usa día; meses y treinta días usan día o semana; años usan mes; `CUSTOM` elige día hasta 31 días, semana hasta 120 y mes hasta 366. Cada punto publica inicio y fin UTC consistentes con los límites locales.

Solo se agregan movimientos `INCOME` y `EXPENSE`, `CONFIRMED`, no eliminados y dentro del periodo. Se excluyen transferencias, cancelados, eliminados, tipos aplazados y datos de otros workspaces. Las fórmulas son:

- `netCashFlow = totalIncome - totalExpenses`.
- `average = total / transactionCount`, o `0.00` cuando no hay movimientos.
- cambio porcentual `= (actual - anterior) / abs(anterior) × 100`, o `null` si el anterior es cero.
- porcentaje de categoría `= amount / totalExpensesInCurrency × 100`.

Dinero y porcentajes se calculan con `Prisma.Decimal`, se redondean a dos decimales y los montos públicos son strings. La suma de porcentajes por categoría puede diferir mínimamente de 100.00 por redondeo.

## Saldos por cuenta y rendimiento

`account-balances` acepta `currency`, `nature`, `type`, `includeArchived`, `search`, `page` y `limit`. Por defecto lista solo cuentas activas y no eliminadas. `includeArchived=true` permite ver archivadas en la lista, pero estas nunca participan en `availableMoney` o `netWorth`. `availableMoney` suma activos actuales; `netWorth` suma activos incluidos y resta el valor absoluto de pasivos incluidos. Se usa `currentBalance` materializado y no se recalcula desde movimientos.

Las agregaciones se ejecutan en PostgreSQL con SQL parametrizado. `income-vs-expenses` usa dos consultas agregadas para actual y anterior; `expenses-by-category` y `cash-flow` usan una cada uno; `account-balances` usa lista, conteo y resumen. No hay consultas por categoría, bucket o cuenta, no se carga el historial completo y no existe N+1.

Ejemplo:

```http
GET /api/v1/workspaces/00000000-0000-0000-0000-000000000000/reports/cash-flow?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31&groupBy=WEEK&currency=COP
Authorization: Bearer <access-token>
```

La respuesta sigue `{ "success": true, "data": ... }`. Contratos inválidos responden `400`, permisos insuficientes `403` y filtros de cuenta o categoría no visibles `404`, sin exponer SQL, Prisma ni campos internos.

Quedan aplazados `includeOther` para categorías, exportaciones y reportes programados. Como `account_balance_snapshots` no contiene historia, el flujo de caja no pretende ser saldo bancario o patrimonio histórico: representa exclusivamente ingresos, gastos y flujo neto del periodo. No se iniciaron deudas, metas, calendario, notificaciones, IA ni la Fase 9.
