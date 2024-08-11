const express = require('express'); 
const app = express();    
const cors = require('cors');
const { open } = require('sqlite');
const path = require('path');
const sqlite3 = require('sqlite3');

// Middleware to parse JSON request bodies
app.use(express.json());

// Enable CORS for all routes
app.use(cors());

const dbPath = path.join(__dirname, "orders.db");
let db = null;

// Function to initialize the database and server
const initializeDBAndServer = async () => {
    try {
        // Open the SQLite database
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database,
        });
        // Start the server on port 3000
        app.listen(8000, () => {
            console.log("Server Running at localhost:8000");
        });
    } catch (e) {
        // Handle database connection errors
        console.log(`DB Error: ${e.message}`);
        process.exit(1);
    }
};

// Initialize the database and server
initializeDBAndServer();

// Endpoint to get all pending orders
app.get("/pending-orders/", async (request, response) => {
    const getQuery = `SELECT * FROM PendingOrderTable`;
    const orders = await db.all(getQuery);
    response.json(orders);
});

// Endpoint to get all completed orders
app.get("/completed-orders/", async (request, response) => {
    const getQuery = "SELECT * FROM CompletedOrderTable";
    const completedOrders = await db.all(getQuery);
    response.json(completedOrders);
});

// Endpoint to create a new order (either buyer or seller)
app.post("/orders/", async (request, response) => {
    const { buyer_qty, buyer_price, seller_price, seller_qty } = request.body;

    if (buyer_qty > 0 && buyer_price > 0) {
        // Buyer's order, need to match with sellers
        let remainingBuyerQty = buyer_qty;

        // Step 1: Find matching sellers
        const matchedSellersQuery = `
            SELECT * FROM PendingOrderTable
            WHERE seller_price <= ${buyer_price} AND seller_qty > 0
            ORDER BY seller_price ASC
        `;
        const matchedSellers = await db.all(matchedSellersQuery);

        // Step 2: Loop through matched sellers to fulfill the buyer's order
        for (const seller of matchedSellers) {
            if (remainingBuyerQty <= 0) break;

            const qtyToMatch = Math.min(remainingBuyerQty, seller.seller_qty);
            remainingBuyerQty -= qtyToMatch;

            // Insert matched quantity into completed orders
            const addCompletedOrderQuery = `
                INSERT INTO CompletedOrderTable (price, qty)
                VALUES (${seller.seller_price}, ${qtyToMatch})
            `;
            await db.run(addCompletedOrderQuery);

            // Update or delete the matched seller's order
            const remainingSellerQty = seller.seller_qty - qtyToMatch;
            if (remainingSellerQty > 0) {
                const updateSellerOrderQuery = `
                    UPDATE PendingOrderTable
                    SET seller_qty = ${remainingSellerQty}
                    WHERE id = ${seller.id}
                `;
                await db.run(updateSellerOrderQuery);
            } else {
                const deleteSellerOrderQuery = `
                    DELETE FROM PendingOrderTable
                    WHERE id = ${seller.id}
                `;
                await db.run(deleteSellerOrderQuery);
            }
        }

        // If there's remaining buyer quantity, add it back to pending orders
        if (remainingBuyerQty > 0) {
            const addBuyerOrderQuery = `
                INSERT INTO PendingOrderTable (buyer_qty, buyer_price, seller_price, seller_qty)
                VALUES (${remainingBuyerQty}, ${buyer_price}, 0, 0)
            `;
            await db.run(addBuyerOrderQuery);
        }

        response.json({
            message: "Order processed successfully",
            remainingBuyerQty
        });

    } else if (seller_qty > 0 && seller_price > 0) {
        // Seller's order, add to pending orders
        const addSellerOrderQuery = `
            INSERT INTO PendingOrderTable (buyer_qty, buyer_price, seller_price, seller_qty)
            VALUES (0, 0, ${seller_price}, ${seller_qty})
        `;
        await db.run(addSellerOrderQuery);
        response.json({ message: "Seller order added successfully" });
    } else {
        response.status(400).json({ error: "Invalid order details" });
    }
});
