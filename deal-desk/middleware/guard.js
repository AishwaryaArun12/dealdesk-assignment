
const jwt = require('jsonwebtoken');
const User = require('../models/User');

function permissionsOf(user) {
    const permissions = user && user.roleId && user.roleId.permissions;
    return Array.isArray(permissions) ? permissions : [];
}

function resolveDataScope(user) {
    const role = user && user.roleId;

    if (
        role &&
        ['all', 'branch', 'own'].includes(role.dataScope)
    ) {
        return role.dataScope;
    }

    const permissions = permissionsOf(user);

    if (permissions.includes('scope.all') || permissions.includes('all')) {
        return 'all';
    }

    if (permissions.includes('scope.branch')) {
        return 'branch';
    }

    return 'own';
}

function branchIdOf(user) {
    const branch = user.branchId;
    return branch && branch._id ? branch._id : branch;
}

// JWT authentication middleware
async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                message: 'Authentication token required'
            });
        }

        const token = authHeader.split(' ')[1];

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId)
            .populate('roleId')
            .populate('branchId')
            .select('-password');

        if (!user) {
            return res.status(401).json({
                message: 'User not found'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid or expired token'
        });
    }
}

function guard(requiredPermission) {
    return function permissionGuard(req, res, next) {
        const permissions = permissionsOf(req.user);

        if (!req.user || !permissions.includes(requiredPermission)) {
            return res.status(403).json({
                message: 'Forbidden'
            });
        }

        next();
    };
}

function applyDataScope(req, baseQuery = {}) {
    const query = { ...baseQuery };

    if (!req.user) {
        query._id = { $exists: false };
        return query;
    }

    const scope = resolveDataScope(req.user);

    if (scope === 'all') {
        return query;
    }

    if (scope === 'branch') {
        query.branchId = branchIdOf(req.user);
        return query;
    }

    query.ownerId = req.user._id;
    return query;
}

module.exports = {
    authenticateToken,
    guard,
    applyDataScope
};
