import * as admin from 'firebase-admin';

import { getNearbyZipcodes, getInfoFromAddress } from '../../utils/location_functions';
import { getTimeFromDateInMilliseconds } from '../../utils/time_functions';

const database = admin.firestore();

const userRef = database.collection('webblen_users');
const eventsRef = database.collection('webblen_events');
const notificationsRef = database.collection('webblen_notifications');


export async function createNotificationForWebblenEvent(event: any, authorUsername: any, followersToNotify: any){
    const header = "@" + authorUsername + " Scheduled a New Event";
    const subHeader = event.title;
    const type = "event";
    const read = false;
    const senderUID = event.authorID;
    const timePostedInMilliseconds = new Date().getTime();
    const expDateInMilliseconds = timePostedInMilliseconds + 7884000000; //post expires in 3 months
    
    //send notification to suggested users if event is public
    if (event.privacy === "Public"){
        for (const uid of followersToNotify) {
            const doc = await userRef.doc(uid).get();
            if (doc.exists) {
                
                const docData = doc.data()!;
                
                //check if user has a message token
                if (docData.messageToken !== undefined && docData.messageToken.length > 0){

                    //check the users last notification time
                    if (docData.lastNotificationTimeInMilliseconds !== undefined){
                        let lastNotificationTimeInMilliseconds = docData.lastNotificationTimeInMilliseconds;
                        if (doc.data()!.lastNotificationTimeInMilliseconds !== undefined) {
                            
                            lastNotificationTimeInMilliseconds = doc.data()!.lastNotificationTimeInMilliseconds;
                            const currentDateInMilliseconds = new Date().getTime();

                            //send notification if it's been at least 30 minutes since the user's last notification
                            if (currentDateInMilliseconds - 3600000 > lastNotificationTimeInMilliseconds) {
                                    
                                const notifKey = (Math.floor(Math.random() * 9999999999) + 1).toString();

                                await notificationsRef.doc(notifKey).set({
                                    'header': header,
                                    'subHeader': subHeader,
                                    'type': type,
                                    'read': read,
                                    'receiverUID': uid,
                                    'senderUID': senderUID,
                                    'expDateInMilliseconds': expDateInMilliseconds,
                                    'timePostedInMilliseconds': currentDateInMilliseconds,
                                    'additionalData': {
                                        'id': event.id,
                                    }
                                });

                                await userRef.doc(uid).update({
                                    "lastNotificationTimeInMilliseconds": currentDateInMilliseconds,
                                });                                           
                            }
                        }
                    }

                }
                
                
            }
        }
    }
}

export async function checkIntoWebblenEvent(data: any, context: any){
    //Get Params
    const eventID = data.eventID;
    const uid = data.uid;
    const userAP = data.ap;

    //Set Check-In Time
    const checkInTimeInMilliseconds = Date.now();

    //Get Event Reference
    const eventDocRef = await eventsRef.doc(eventID);
    const eventDoc = await eventDocRef.get();

    //Get Current Event Attendees
    const attendees = eventDoc.data()!.attendees;

    //Check If User Has Already Checked-In
    for (const val of attendees){
        if (uid in val){
           return;
        } 
    }

    //If User Has NOT Checked-In, Log Check-In
    const checkIn = {
        uid: {
            'checkInTime': checkInTimeInMilliseconds,
            'checkOutTime': null,
            'ap': userAP,
        }
    };

    attendees.push(checkIn);

    //Update Event Attendees
    await eventDocRef.update({
        'attendees': attendees,
    });

    //Update User AP
    if (userAP > 0.02) {
        const updatedAP = userAP - 0.02;
        await userRef.doc(data.uid).update({ 'ap': updatedAP });
    }

    return true;

}

export async function checkOutOfWebblenEvent(data: any, context: any){
    //Get Params
    const eventID = data.eventID;
    const uid = data.uid;

    //Set Check-In Time
    const checkOutTimeInMilliseconds = Date.now();

    //Get Event Reference
    const eventDocRef = await eventsRef.doc(eventID);
    const eventDoc = await eventDocRef.get();

    //Get Current Event Attendees
    const attendees = eventDoc.data()!.attendees;

    //Check If User Has Already Checked-Out
    for (const val of attendees){
        if (uid in val){
            val['checkOutTime'] = checkOutTimeInMilliseconds;
        } 
    }

    //Update Event Attendees
    return eventDocRef.update({
        'attendees': attendees,
    });

}

export async function calculateAndDistributeEventPayouts(event: any) {
    const currentDateTime = Date.now();
    const eventSnapshots = await eventsRef
        .where('paidOut', '==', false)
        .where('endDateTimeInMilliseconds', '<=', currentDateTime)
        .get();
    for (const eventDoc of eventSnapshots.docs) {
        const eventData = eventDoc.data().d;
        const attendees = eventData.attendees;

        //get uids from attendees data map
        for (const uid in attendees) {

            //attendee check in & check out times
            // const attendeeData = attendees[uid];
            // const checkInTimeInMilliseconds = attendeeData['checkInTime'];
            // let checkOutTimeInMilliseconds = event.endDateTimeInMilliseconds;
            // if (attendeeData['checkOutTime'] != undefined && checkInTimeInMilliseconds != null && attendeeData != checkOutTimeInMilliseconds){
            //     checkOutTimeInMilliseconds = attendeeData['checkOutTime'];
            // }
            
            const userDoc = await userRef.doc(uid).get();
            const userData = userDoc.data()!.d;
            let ap = userData.ap;
            if (ap <= 5.00) {
                ap = ap + 0.04;
            }
            const pay = 1 + (ap * attendees.length);
            const newBalance = userData.WBLN + pay;
            await userRef.doc(uid).update({ "ap": ap, "WBLN": newBalance });
        }
        await eventsRef.doc(eventDoc.id).update({ 'paidOut': true });
    }
}

export async function createWebblenEventFromScrapedData(data: any) {
    const scrapedEvent = data;

    const scrapedEventId = scrapedEvent.id;
    // const scrapedEventCity = scrapedEvent.city;
    const scrapedEventAddress = scrapedEvent.address;
    const scrapedEventDate = scrapedEvent.date;
    const scrapedEventDesc = scrapedEvent.description;
    const scrapedEventEndTime = scrapedEvent.end_time;
    const scrapedEventImageUrl = scrapedEvent.image_url;
    const scrapedEventStartTime = scrapedEvent.start_time;
    const scrapedEventState = scrapedEvent.state;
    const scrapedEventTitle = scrapedEvent.title
    const scrapedEventUrl = scrapedEvent.url;

    // -------------------------------- Example locationInfo ----------------------------------
    // {
    //     "latitude": 48.8698679,
    //     "longitude": 2.3072976,
    //     "country": "France",
    //     "countryCode": "FR",
    //     "city": "Paris",
    //     "zipcode": "75008",
    //     "streetName": "Champs-??lys??es",
    //     "streetNumber": "29",
    //     "administrativeLevels": {
    //       "level1long": "??le-de-France",
    //       "level1short": "IDF",
    //       "level2long": "Paris",
    //       "level2short": "75"
    //     },
    //     "provider": "google"
    //   }
    // -------------------------------- Example locationInfo ----------------------------------

    const locationInfo = await getInfoFromAddress(scrapedEventAddress);
    const lat = locationInfo.latitude;
    const lon = locationInfo.longitude;
    const zipcode = locationInfo.zipcode;
    const city = locationInfo.city;

    const nearbyZipcodes = await getNearbyZipcodes(zipcode);

    const eventFromScrapedEventMap = {
        'actualTurnout': 0,
        'attendees': {},
        'authorID': "EtKiw3gK37QsOg6tPBnSJ8MhCm23",
        'city': city,
        'clicks': 0,
        'description': scrapedEventDesc,
        'endDate': scrapedEventDate,
        'endDateTimeInMilliseconds': getTimeFromDateInMilliseconds(scrapedEventDate, scrapedEventEndTime),
        'endTime': scrapedEventEndTime,
        'estimatedTurnout': 0,
        'eventPayout': 0,
        'fbUsername': '',
        'flashEvent': false,
        'hasStream': false,
        'hasTickets': false,
        'id': scrapedEventId,
        'imageURL': scrapedEventImageUrl,
        'instaUsername': '',
        'lat': lat,
        'lon': lon,
        'nearbyZipcodes': nearbyZipcodes,
        'openToSponsors': false,
        'paidOut': false,
        'privacy': 'Public',
        'province': scrapedEventState,
        'recurrence': 'none',
        'reported': 'false',
        'savedBy': [],
        'sharedComs': [],
        'startDate': scrapedEventDate,
        'startDateTimeInMilliseconds': getTimeFromDateInMilliseconds(scrapedEventDate, scrapedEventStartTime),
        'startTime': scrapedEventStartTime,
        'streetAddress': scrapedEventAddress,
        'tags': [],
        'timezone': 'CST',
        'title': scrapedEventTitle,
        'twitterUsername': '',
        'venueName': '',
        'venueSize': 'medium',
        'webAppLink': `https://app.webblen.io/#/event?id=${scrapedEventId}`,
        'website': scrapedEventUrl,
    }

    return eventFromScrapedEventMap;
}

export async function fixWebblenEvents(){
    const query = await eventsRef.where('authorID', "==", "EtKiw3gK37QsOg6tPBnSJ8MhCm23").get();
    for (const doc of query.docs){
        await eventsRef.doc(doc.id).update({
            'attendees': {},
            'timezone': "CST",
            'privacy': "Public",
        });
    }
}