INSERT INTO permissions (id, code, description)
SELECT gen_random_uuid(), 'goals.read', 'Consultar metas de ahorro'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'goals.read');

INSERT INTO permissions (id, code, description)
SELECT gen_random_uuid(), 'goals.write', 'Crear y modificar metas de ahorro'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'goals.write');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('goals.read', 'goals.write')
WHERE r.code = 'OWNER'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
