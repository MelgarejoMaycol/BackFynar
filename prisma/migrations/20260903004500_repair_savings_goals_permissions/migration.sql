-- Asegura que los permisos de metas existan incluso si una base de datos de producción
-- quedó desalineada durante el despliegue inicial del módulo.
INSERT INTO permissions (id, code, description)
SELECT gen_random_uuid(), 'goals.read', 'Consultar metas de ahorro'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'goals.read');

INSERT INTO permissions (id, code, description)
SELECT gen_random_uuid(), 'goals.write', 'Crear y modificar metas de ahorro'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'goals.write');

-- El propietario de un workspace debe conservar control total, incluido el módulo de metas.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('goals.read', 'goals.write')
WHERE r.code = 'OWNER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Repara workspaces legacy donde el usuario propietario pudiera haber quedado asociado
-- accidentalmente a un rol distinto de OWNER. El owner_user_id es la fuente de verdad.
UPDATE workspace_members AS wm
SET role_id = owner_role.id
FROM workspaces AS w
CROSS JOIN roles AS owner_role
WHERE wm.workspace_id = w.id
  AND wm.user_id = w.owner_user_id
  AND owner_role.code = 'OWNER'
  AND wm.role_id <> owner_role.id;
