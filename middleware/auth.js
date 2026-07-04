function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.redirect('/dashboard');
}

function isCS(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'cs') {
    return next();
  }
  res.redirect('/dashboard');
}

function isAdminOrCS(req, res, next) {
  if (req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'cs')) {
    return next();
  }
  res.redirect('/dashboard');
}

function isManagement(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'management') {
    return next();
  }
  res.redirect('/dashboard');
}

function isTeknisi(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'teknisi') {
    return next();
  }
  res.redirect('/dashboard');
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { isAuthenticated, isAdmin, isCS, isAdminOrCS, isManagement, isTeknisi, redirectIfAuthenticated };
