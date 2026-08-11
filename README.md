# Fynar API

API del MVP de Fynar construida con Node.js, Express, TypeScript, Prisma y PostgreSQL.

## Instalación

```bash
npm ci
copy .env.example .env
npm run prisma:generate
```

Configura en `.env` la conexión PostgreSQL, los secretos JWT y, para subir avatares, las credenciales de Cloudinary. Nunca versiones ese archivo.

## Desarrollo

```bash
npm run dev
```

## Base de datos

```bash
npm run prisma:migrate:deploy
npm run prisma:seed
```

El esquema y las migraciones versionadas se encuentran en `prisma/`.

## Calidad

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Consulta [README_FYNAR.md](./README_FYNAR.md) para la documentación técnica y funcional ampliada.
