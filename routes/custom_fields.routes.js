const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Auto-initialize custom_fields schema if it does not exist
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS custom_fields (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT DEFAULT 1,
        module VARCHAR(50) NOT NULL,
        field_key VARCHAR(100) NOT NULL,
        label VARCHAR(150) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'text',
        tab_id VARCHAR(50) DEFAULT 'overview',
        required BOOLEAN DEFAULT FALSE,
        visible BOOLEAN DEFAULT TRUE,
        options JSON,
        placeholder VARCHAR(255),
        order_index INT DEFAULT 0,
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_module (module),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    console.warn('Notice: custom_fields table init deferred:', err.message);
  }
})();

// GET /api/custom-fields (filter by module)
router.get('/', async (req, res) => {
  try {
    const { module: moduleName } = req.query;
    let query = 'SELECT * FROM custom_fields';
    const params = [];

    if (moduleName) {
      query += ' WHERE module = ?';
      params.push(moduleName);
    }
    query += ' ORDER BY order_index ASC, id ASC';

    const [rows] = await db.query(query, params);
    res.json({ success: true, fields: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/custom-fields (create new custom field)
router.post('/', async (req, res) => {
  try {
    const {
      module: moduleName,
      field_key,
      label,
      type = 'text',
      tab_id = 'overview',
      required = false,
      visible = true,
      options,
      placeholder,
      order_index = 0
    } = req.body;

    if (!moduleName || !field_key || !label) {
      return res.status(400).json({ success: false, message: 'module, field_key, and label are required' });
    }

    const optionsJson = options ? JSON.stringify(options) : null;

    const [result] = await db.query(
      `INSERT INTO custom_fields 
       (module, field_key, label, type, tab_id, required, visible, options, placeholder, order_index, is_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [moduleName, field_key, label, type, tab_id, !!required, visible !== false, optionsJson, placeholder || null, order_index]
    );

    res.status(201).json({
      success: true,
      message: 'Custom field created successfully',
      fieldId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/custom-fields/:id (update label, visibility, tab, required)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['label', 'visible', 'required', 'tab_id', 'options', 'placeholder', 'order_index'];
    const updates = [];
    const values = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(key === 'options' && req.body[key] ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid update fields provided' });
    }

    values.push(id);
    await db.query(`UPDATE custom_fields SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'Custom field updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/custom-fields/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM custom_fields WHERE id = ? AND is_system = FALSE', [id]);
    res.json({ success: true, message: 'Custom field deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
