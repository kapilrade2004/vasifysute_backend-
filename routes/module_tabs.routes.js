const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Auto-initialize module_tabs schema if it does not exist
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS module_tabs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT DEFAULT 1,
        module VARCHAR(50) NOT NULL,
        tab_key VARCHAR(100) NOT NULL,
        label VARCHAR(150) NOT NULL,
        visible BOOLEAN DEFAULT TRUE,
        order_index INT DEFAULT 0,
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_module (module),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    console.warn('Notice: module_tabs table init deferred:', err.message);
  }
})();

// GET /api/module-tabs (filter by module)
router.get('/', async (req, res) => {
  try {
    const { module: moduleName } = req.query;
    let query = 'SELECT * FROM module_tabs';
    const params = [];

    if (moduleName) {
      query += ' WHERE module = ?';
      params.push(moduleName);
    }
    query += ' ORDER BY order_index ASC, id ASC';

    const [rows] = await db.query(query, params);
    res.json({ success: true, tabs: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/module-tabs (create new custom tab)
router.post('/', async (req, res) => {
  try {
    const {
      module: moduleName,
      tab_key,
      label,
      visible = true,
      order_index = 0
    } = req.body;

    if (!moduleName || !label) {
      return res.status(400).json({ success: false, message: 'module and label are required' });
    }

    const key = tab_key || label.toLowerCase().replace(/[^a-z0-9]/g, '_');

    const [result] = await db.query(
      `INSERT INTO module_tabs 
       (module, tab_key, label, visible, order_index, is_system)
       VALUES (?, ?, ?, ?, ?, FALSE)`,
      [moduleName, key, label, visible !== false, order_index]
    );

    res.status(201).json({
      success: true,
      message: 'Module tab created successfully',
      tabId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/module-tabs/:id (update label, visibility, order_index)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['label', 'visible', 'order_index'];
    const updates = [];
    const values = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid update fields provided' });
    }

    values.push(id);
    await db.query(`UPDATE module_tabs SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'Module tab updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/module-tabs/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM module_tabs WHERE id = ? AND is_system = FALSE', [id]);
    res.json({ success: true, message: 'Module tab deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
