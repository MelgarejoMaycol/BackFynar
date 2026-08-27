# Eliminación de cuenta en la beta

La operación `DELETE /api/v1/users/me` exige la confirmación exacta `ELIMINAR` y es irreversible.

## Tratamiento técnico actual

- **Eliminados inmediatamente:** identidades Google/local asociadas, refresh tokens, tokens de
  recuperación/verificación/cambio de correo, dispositivos, preferencias y notificaciones.
- **Anonimizados inmediatamente:** correo, nombre, apellido, teléfono y avatar del usuario. La
  cuenta queda inactiva y con fecha de eliminación; ningún access token previo supera el control
  de sesión de `authenticate`.
- **Conservados:** workspaces, cuentas, categorías, movimientos, presupuestos, deudas, tarjetas,
  eventos financieros y auditoría financiera. Permanecen vinculados al UUID desactivado para no
  alterar saldos, trazabilidad ni relaciones contables. Los payloads de auditoría del perfil del
  usuario se vacían.

## Decisión pendiente antes del lanzamiento público

El responsable del producto y su asesor jurídico deben definir el plazo de retención, el proceso
de purga posterior y el canal para ejercer derechos. Esta implementación no presume un plazo ni
una obligación legal concreta.
