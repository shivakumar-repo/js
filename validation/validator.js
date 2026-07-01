//bind events
document.addEventListener("beforeinput", function (e) {
    const input = e.target;

    if (input.tagName !== "INPUT")
        return;

    switch (input.dataset.type) {
		case "decimal":
			validateDecimal(e, input);
			break;

		case "text":
			validateText(e, input);
			break;

		case "integer":
			validateInteger(e, input);
			break;

		case "phone":
			formatPhone(e, input);
			validatePhone(e, input);
			break;

		case "email":
			validateEmail(e, input);
			break;
		
		case "ip":
			formatIpAddress(input);
			validateIpAddress(e, input);
			break;
			
	}
});

document.addEventListener("input", function (e) {
    const input = e.target;

    if (input.tagName !== "INPUT")
        return;

    if (input.dataset.type === "text") {

        if (input.dataset.case === "upper")
            input.value = input.value.toUpperCase();

        else if (input.dataset.case === "lower")
            input.value = input.value.toLowerCase();
    }
});

function validateDecimal(e, input) {

    if (
        e.inputType.startsWith("delete") ||
        e.inputType === "historyUndo" ||
        e.inputType === "historyRedo"
    )
        return;

    const maxL = Number(input.dataset.maxl);
    const maxD = Number(input.dataset.maxd);

    const next =
        input.value.substring(0, input.selectionStart) +
        (e.data ?? "") +
        input.value.substring(input.selectionEnd);

    if (next === "")
        return;

    // +12.34  -12.34  12.34  12.
    if (!/^[+-]?\d*(?:\.\d*)?$/.test(next)) {
        e.preventDefault();
        return;
    }

    if (next === "+" || next === "-")
        return;

    const parts = next.replace(/^[+-]/, "").split(".");
    const intPart = parts[0] || "";
    const decPart = parts[1] || "";

    if (intPart.length > maxL) {
		e.preventDefault();
		return;
	}

	if (decPart.length > maxD) {
		e.preventDefault();
		return;
	}

    if (decPart.length > maxD)
        e.preventDefault();
}


function validateText(e, input) {

    if (
        e.inputType.startsWith("delete") ||
        e.inputType === "historyUndo" ||
        e.inputType === "historyRedo"
    )
        return;

    const maxL = Number(input.dataset.maxl);

    const next =
        input.value.substring(0, input.selectionStart) +
        (e.data ?? "") +
        input.value.substring(input.selectionEnd);

    // Allow only A-Z a-z 0-9
    if (!/^[A-Za-z0-9]*$/.test(next)) {
        e.preventDefault();
        return;
    }

    if (next.length > maxL)
        e.preventDefault();
}


const phoneFormats = {
    us: [3, 3, 4],      // 123 456 7890
    ca: [3, 3, 4],      // 123 456 7890
    gb: [5, 3, 3],      // 07123 456 789
    de: [4, 7],         // 1512 3456789 (simplified)
    cz: [3, 3, 3],      // 123 456 789
    in: [5, 5]          // 98765 43210
};

function formatPhone(e,input) {

    const locale = (input.dataset.locale || "us").toLowerCase();
    const groups = phoneFormats[locale] || [3, 3, 4];

    let value = input.value.replace(/[^\d+]/g, "");

    const plus = value.startsWith("+");
    value = value.replace("+", "");

    // Maximum digits allowed for this locale
    const maxDigits = groups.reduce((sum, n) => sum + n, 0);

    // Trim extra digits
    value = value.substring(0, maxDigits);

    const result = [];
    let pos = 0;

    for (const len of groups) {

        if (pos >= value.length)
            break;

        result.push(value.substring(pos, pos + len));
        pos += len;
    }

    input.value = (plus ? "+" : "") + result.join(" ");
}

function validatePhone(e, input) {

    if (
        e.inputType.startsWith("delete") ||
        e.inputType === "historyUndo" ||
        e.inputType === "historyRedo"
    )
        return;

    const next =
        input.value.substring(0, input.selectionStart) +
        (e.data ?? "") +
        input.value.substring(input.selectionEnd);

    const digits = next.replace(/\s/g, "");

    // Only digits and an optional leading +
    if (!/^\+?\d*$/.test(digits)) {
        e.preventDefault();
    }
}

function validateIpAddress(e, input) {

    if (
        e.inputType.startsWith("delete") ||
        e.inputType === "historyUndo" ||
        e.inputType === "historyRedo"
    )
        return;

    const next =
        input.value.substring(0, input.selectionStart) +
        (e.data ?? "") +
        input.value.substring(input.selectionEnd);

    // Only digits and dots
    if (!/^[0-9.]*$/.test(next)) {
        e.preventDefault();
    }
}

function formatIpAddress(input) {

    let value = input.value.replace(/[^\d.]/g, "");

    // Remove multiple consecutive dots
    value = value.replace(/\.{2,}/g, ".");

    const octets = value.split(".");
    const result = [];

    for (let i = 0; i < Math.min(octets.length, 4); i++) {

        let octet = octets[i];

        if (octet === "") {
            result.push("");
            continue;
        }

        // Maximum 3 digits
        octet = octet.substring(0, 3);

        let n = Number(octet);

        if (n > 255)
            n = 255;

        result.push(String(n));
    }

    input.value = result.join(".");
}
