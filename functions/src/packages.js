const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { authenticateAdmin } = require('./vouchers'); // Import admin auth middleware

const db = admin.firestore();

// 1. GET /api/packages - List active packages (Public)
router.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('packages')
            .where('active', '==', true)
            .get();

        const packages = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            packages.push({
                id: doc.id,
                name: data.name,
                price_kes: data.price_kes,
                duration_hours: data.duration_hours,
                data_limit_mb: data.data_limit_mb || null,
                speed_up_kbps: data.speed_up_kbps || null,
                speed_down_kbps: data.speed_down_kbps || null,
                active: data.active
            });
        });

        // Sort by price ascending
        packages.sort((a, b) => a.price_kes - b.price_kes);

        return res.json({ success: true, data: packages });

    } catch (error) {
        console.error('Error fetching packages:', error);
        return res.status(500).json({ success: false, error: 'Internal server error fetching packages' });
    }
});

// Helper: Validate package schema input
function validatePackageInput(body) {
    const { name, price_kes, duration_hours, data_limit_mb, speed_up_kbps, speed_down_kbps } = body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return 'Invalid package name';
    }
    if (price_kes === undefined || typeof price_kes !== 'number' || price_kes < 0) {
        return 'Price (KES) must be a non-negative integer number';
    }
    if (duration_hours === undefined || typeof duration_hours !== 'number' || duration_hours <= 0) {
        return 'Duration (hours) must be a positive number';
    }
    if (data_limit_mb !== undefined && data_limit_mb !== null && (typeof data_limit_mb !== 'number' || data_limit_mb < 0)) {
        return 'Data limit (MB) must be a non-negative number';
    }
    if (speed_up_kbps !== undefined && speed_up_kbps !== null && (typeof speed_up_kbps !== 'number' || speed_up_kbps < 0)) {
        return 'Speed Up (Kbps) must be a non-negative number';
    }
    if (speed_down_kbps !== undefined && speed_down_kbps !== null && (typeof speed_down_kbps !== 'number' || speed_down_kbps < 0)) {
        return 'Speed Down (Kbps) must be a non-negative number';
    }
    return null; // No error
}

// 2. POST /api/packages - Create a package (Admin-Only)
router.post('/', authenticateAdmin, async (req, res) => {
    const validationError = validatePackageInput(req.body);
    if (validationError) {
        return res.status(400).json({ success: false, error: validationError });
    }

    const { name, price_kes, duration_hours, data_limit_mb, speed_up_kbps, speed_down_kbps, active } = req.body;

    try {
        const packageRef = db.collection('packages').doc();
        const packageData = {
            id: packageRef.id,
            name: name.trim(),
            price_kes: Math.round(price_kes), // Ensure integer KES
            duration_hours: Number(duration_hours),
            data_limit_mb: data_limit_mb ? Number(data_limit_mb) : null,
            speed_up_kbps: speed_up_kbps ? Number(speed_up_kbps) : null,
            speed_down_kbps: speed_down_kbps ? Number(speed_down_kbps) : null,
            active: active !== undefined ? Boolean(active) : true,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        };

        await packageRef.set(packageData);
        
        return res.json({ success: true, data: packageData });

    } catch (error) {
        console.error('Error creating package:', error);
        return res.status(500).json({ success: false, error: 'Internal server error creating package' });
    }
});

// 3. PUT /api/packages/:id - Update a package (Admin-Only)
router.put('/:id', authenticateAdmin, async (req, res) => {
    const packageId = req.params.id;
    
    const validationError = validatePackageInput(req.body);
    if (validationError) {
        return res.status(400).json({ success: false, error: validationError });
    }

    const { name, price_kes, duration_hours, data_limit_mb, speed_up_kbps, speed_down_kbps, active } = req.body;

    try {
        const packageRef = db.collection('packages').doc(packageId);
        const packageDoc = await packageRef.get();

        if (!packageDoc.exists) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        const updateData = {
            name: name.trim(),
            price_kes: Math.round(price_kes),
            duration_hours: Number(duration_hours),
            data_limit_mb: data_limit_mb ? Number(data_limit_mb) : null,
            speed_up_kbps: speed_up_kbps ? Number(speed_up_kbps) : null,
            speed_down_kbps: speed_down_kbps ? Number(speed_down_kbps) : null,
            active: active !== undefined ? Boolean(active) : true,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };

        await packageRef.update(updateData);
        
        return res.json({ success: true, data: { id: packageId, ...updateData } });

    } catch (error) {
        console.error('Error updating package:', error);
        return res.status(500).json({ success: false, error: 'Internal server error updating package' });
    }
});

// 4. DELETE /api/packages/:id - Delete a package (Admin-Only)
router.delete('/:id', authenticateAdmin, async (req, res) => {
    const packageId = req.params.id;

    try {
        const packageRef = db.collection('packages').doc(packageId);
        const packageDoc = await packageRef.get();

        if (!packageDoc.exists) {
            return res.status(404).json({ success: false, error: 'Package not found' });
        }

        // We do a hard delete in Firestore
        await packageRef.delete();
        
        return res.json({ success: true, data: { message: 'Package deleted successfully' } });

    } catch (error) {
        console.error('Error deleting package:', error);
        return res.status(500).json({ success: false, error: 'Internal server error deleting package' });
    }
});

module.exports = router;
