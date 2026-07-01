function toggleSidebar() {
  document.getElementById('sidebarMenu').classList.toggle('open');
  var overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', function() {
  var notifBadges = document.querySelectorAll('.sidebar .badge, .nav-link .badge');
  function updateBadge() {
    fetch('/api/notifications/count')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        for (var i = 0; i < notifBadges.length; i++) {
          notifBadges[i].textContent = d.count || '';
        }
      })
      .catch(function() {});
  }
  if (notifBadges.length > 0) {
    setInterval(updateBadge, 30000);
  }
});
