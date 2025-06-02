document.addEventListener('DOMContentLoaded', function() {
    // Password visibility toggle
    const togglePassword = document.querySelector('.toggle-password');
    const passwordInput = document.getElementById('password');
    
    togglePassword.addEventListener('click', function() {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        this.classList.toggle('fa-eye-slash');
    });
    
    // Form submission
    const loginForm = document.getElementById('loginForm');
    
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Clear previous errors
        document.getElementById('email-error').style.display = 'none';
        document.getElementById('password-error').style.display = 'none';
        
        // Get values
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        let isValid = true;

        // Validation
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            document.getElementById('email-error').textContent = 'Please enter a valid email';
            document.getElementById('email-error').style.display = 'block';
            isValid = false;
        }

        if (!password || password.length < 8) {
            document.getElementById('password-error').textContent = 'Password must be at least 8 characters';
            document.getElementById('password-error').style.display = 'block';
            isValid = false;
        }

        if (!isValid) return;

        // UI Loading state
        const submitBtn = document.querySelector('.login-btn');
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
        submitBtn.disabled = true;

        try {
            const response = await fetch('http://localhost:3000/logIn/', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password })
            });

            // Handle non-JSON responses
            const text = await response.text();
            const data = text ? JSON.parse(text) : {};
            
            if (!response.ok) {
                throw new Error(data.message || `Server error: ${response.status}`);
            }

            if (data.success) {
                localStorage.setItem('isLoggedIn', 'true');
                window.location.href = 'mainPage.html'; // Adjusted path
            } else {
                throw new Error(data.message || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert(error.message || 'An error occurred during login');
        } finally {
            submitBtn.innerHTML = 'Log In';
            submitBtn.disabled = false;
        }
    });
});