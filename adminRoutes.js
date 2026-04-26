export const adminAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const token = authHeader.split(' ')[1];
    if (token !== process.env.ADMIN_PASSWORD) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    next();
};
