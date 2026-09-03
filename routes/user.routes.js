const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

// User CRUD Routes
router.post('/users', userController.createUser);
router.get('/users', userController.getUsers);
router.get('/users/check-trials', userController.checkTrials);
router.get('/users/:id', userController.getUser);
router.put('/users/:id', userController.updateUser);
router.delete('/users/:id', userController.deleteUser);
router.post('/users/send-test-email', userController.sendTestEmail);
router.post('/users/:id/upgrade', userController.upgradeUser);

module.exports = router;
