const form = document.getElementById("applyForm");

if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        try {
            const res = await fetch((window.API_BASE || "") + "/api/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nomPrenom: document.getElementById("nomPrenom").value,
                    age: document.getElementById("age").value,
                    motivation: document.getElementById("motivation").value,
                    experience: document.getElementById("experience").value,
                    disponibilites: document.getElementById("disponibilites").value
                })
            });

            if (res.status === 401) {
                alert("Connecte-toi avec Discord avant de postuler.");
                window.location.href = (window.API_BASE || "") + "/auth/discord";
                return;
            }

            if (!res.ok) {
                const error = await res.json().catch(() => ({ error: "Erreur serveur." }));
                alert(error.error || "Erreur lors de l'envoi de la candidature.");
                return;
            }

            alert("Candidature envoyée avec succès.");
            form.reset();
        } catch (error) {
            console.error("Erreur réseau:", error);
            alert("Erreur de connexion. Veuillez réessayer.");
        }
    });
}