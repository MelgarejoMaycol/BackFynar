# Pruebas de integración

Estas pruebas crean y eliminan datos. Nunca aceptan `DATABASE_URL`: exigen una URL separada en
`DATABASE_URL_TEST`, `NODE_ENV=test`, `ALLOW_DATABASE_TESTS=true`, un nombre de base que contenga
`test` o `testing`, y rechazan hosts compartidos conocidos.

1. Copia `.env.test.example` a un archivo local no versionado y configura una instancia PostgreSQL
   exclusiva.
2. Exporta sus variables en la terminal.
3. Ejecuta, en orden:

```bash
npm run prisma:migrate:test
npm run prisma:seed:test
npm run test:integration
```

GitHub Actions levanta PostgreSQL 16 efímero y ejecuta la misma secuencia sin usar Neon.
